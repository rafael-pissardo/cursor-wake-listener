import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { captureShouldStop, concatInt16, rms, thresholdFromProbe } from "./audio.js";
import { sendToCursor } from "./send-to-cursor.js";
import { transcribe, warmUpStt } from "./stt.js";
import { DEFAULT_NEW_CHAT_PHRASES } from "./transcript.js";
import { resolveListenTurn } from "./listen-turn.js";
import { decodeWavPcm16, resampleTo16k } from "./wav.js";
import { startHud } from "./hud.js";
import { startTray } from "./tray.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const args = process.argv.slice(2);
const phrases = config.wakePhrases;
const newChatPhrases = config.newChatPhrases ?? DEFAULT_NEW_CHAT_PHRASES;
const wakeOptions = { maxDistance: Number(config.wakeFuzzyMaxDistance ?? 2) };
const wakeLabel = phrases.join('" / "');
let threshold = Number(config.speechRmsThreshold ?? 0.001);

function sttLoadOptions() {
  return {
    dtype: config.whisperDtype ?? "q8",
    device: config.whisperDevice ?? "cpu",
    deviceId: config.whisperDeviceId,
    whisperCpp: {
      backend: config.sttBackend ?? "auto",
      binary: config.whisperCppBinary ?? "",
      model: config.whisperCppModel ?? "",
      language: config.whisperCppLanguage ?? "pt",
      extraArgs: config.whisperCppExtraArgs ?? [],
    },
  };
}

let tray;
let hud;

function playCue(kind) {
  const command =
    kind === "armed"
      ? "[console]::beep(784,320); [console]::beep(1046,1100)"
      : "[console]::beep(988,220); [console]::beep(784,500)";
  spawn("powershell.exe", ["-NoProfile", "-Command", command], {
    windowsHide: true,
    stdio: "ignore",
  });
}

async function probeMic(recorder) {
  const levels = [];
  for (let i = 0; i < 10; i += 1) {
    const frame = await recorder.read();
    levels.push(rms(frame));
  }
  const peak = Math.max(...levels);
  const avg = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  threshold = thresholdFromProbe({
    avg,
    peak,
    fallback: Number(config.speechRmsThreshold ?? 0.001),
  });
  console.log(
    `Probe do microfone: rms medio=${avg.toFixed(4)} pico=${peak.toFixed(4)} limiar=${threshold.toFixed(4)}`,
  );
  console.log("Fale juarez ou ok e espere o HUD azul. Depois o pedido.");
}

async function waitForSpeech(recorder, { until = 0 } = {}) {
  let lastLog = Date.now();
  const recent = [];
  while (true) {
    if (until && Date.now() >= until) return null;
    const frame = Int16Array.from(await recorder.read());
    const level = rms(frame);
    recent.push(level);
    if (recent.length > 4) recent.shift();
    const peak = Math.max(...recent);
    if (Date.now() - lastLog > 2000) {
      console.log(`mic rms=${level.toFixed(4)} pico=${peak.toFixed(4)} limiar=${threshold.toFixed(4)}`);
      lastLog = Date.now();
    }
    if (peak >= threshold) return frame;
  }
}

async function captureUntilSilence(recorder, frameMs, firstFrame) {
  const chunks = [firstFrame];
  const started = Date.now();
  let silenceMs = 0;

  while (true) {
    const copy = Int16Array.from(await recorder.read());
    chunks.push(copy);
    const currentRms = rms(copy);
    if (currentRms >= threshold) silenceMs = 0;
    else silenceMs += frameMs;

    const reason = captureShouldStop({
      elapsedMs: Date.now() - started,
      silenceMs,
      silenceThresholdMs: config.silenceMs,
      minCaptureMs: config.minCaptureMs,
      maxCaptureMs: config.maxCaptureSeconds * 1000,
      heardSpeech: true,
      currentRms,
      speechRmsThreshold: threshold,
    });
    if (reason) return concatInt16(chunks);
  }
}

async function fromWav(path, { dryRun }) {
  await warmUpStt(config.whisperModel, sttLoadOptions());
  const bytes = await readFile(path);
  const { sampleRate, pcm } = decodeWavPcm16(bytes);
  const resampled = resampleTo16k(pcm, sampleRate);
  console.log(`WAV ${path} ${sampleRate}Hz -> 16000Hz (${resampled.length} samples)`);
  await handleUtterance(resampled, { armed: false, dryRun });
}

async function handleUtterance(pcm, { armed, dryRun = false }) {
  if (armed) {
    console.log("Transcrevendo pedido...");
    hud?.show("transcribing");
    tray?.setTooltip("Cursor Wake — transcrevendo");
  } else {
    console.log("Conferindo Juarez...");
  }
  const raw = await transcribe(pcm, {
    model: config.whisperModel,
    language: config.language,
    numBeams: config.whisperBeams ?? 1,
    ...sttLoadOptions(),
  });
  console.log(`Ouvi: "${raw}"`);
  const turn = resolveListenTurn({
    armed,
    raw,
    phrases,
    wakeOptions,
    newChatPhrases,
  });

  if (turn.kind === "arm") {
    playCue("armed");
    console.log("Juarez. HUD azul: fale o pedido.");
    hud?.show("armed");
    tray?.setTooltip("Cursor Wake — pode falar");
    return true;
  }

  if (turn.kind === "idle-ignore") {
    console.log("Ainda esperando Juarez.");
    hud?.show("hide");
    return false;
  }

  if (turn.kind === "noise") {
    console.log("Nao entendi o pedido. Pode repetir.");
    hud?.show("armed");
    return true;
  }

  if (dryRun) {
    const where = turn.newChat ? "novo chat; " : "";
    console.log(`Dry-run: nao colei no Cursor. ${where}Prompt seria: "${turn.command}"`);
    return false;
  }

  await sendToCursor(turn.command, {
    openAgentHotkey: Boolean(config.openAgentHotkey),
    submit: Boolean(config.submit),
    newChat: turn.newChat,
    newChatHotkey: config.newChatHotkey,
  });
  playCue("sent");
  console.log(turn.newChat ? "Enviado para um novo chat do Cursor." : "Enviado para o Cursor.");
  hud?.show("sent");
  tray?.setTooltip("Cursor Wake — esperando Juarez");
  return false;
}

function resolveMicDeviceIndex() {
  if (Number.isInteger(config.micDeviceIndex) && config.micDeviceIndex >= 0) {
    return config.micDeviceIndex;
  }
  const match = String(config.micDeviceMatch ?? "").trim().toLowerCase();
  if (!match) return -1;
  const devices = PvRecorder.getAvailableDevices();
  const index = devices.findIndex((name) => name.toLowerCase().includes(match));
  return index >= 0 ? index : -1;
}

async function listen() {
  let recorder;
  const shutdownRecorder = () => {
    try {
      recorder?.release();
    } catch {
      /* already released */
    }
    tray?.kill();
    hud?.stop();
  };

  tray = await startTray({
    onExit: () => {
      shutdownRecorder();
      process.exit(0);
    },
  });
  hud = startHud({ enabled: config.visualFeedback !== false });

  await warmUpStt(config.whisperModel, sttLoadOptions());
  const deviceIndex = resolveMicDeviceIndex();
  const frameLength = config.frameLength ?? 512;
  recorder = new PvRecorder(frameLength, deviceIndex);
  const frameMs = (frameLength / recorder.sampleRate) * 1000;
  recorder.start();
  console.log(
    `Escutando "${wakeLabel}" em "${recorder.getSelectedDevice()}". Ctrl+C para sair.`,
  );
  await probeMic(recorder);
  tray.setTooltip("Cursor Wake — esperando Juarez");

  const shutdown = () => {
    shutdownRecorder();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGBREAK", shutdown);

  let armed = false;
  let armedUntil = 0;
  const armedTimeoutMs = Number(config.armedTimeoutMs ?? 8000);
  while (true) {
    const firstFrame = await waitForSpeech(recorder, {
      until: armed ? armedUntil : 0,
    });
    if (!firstFrame) {
      console.log("Nenhum pedido. Voltei a esperar Juarez.");
      hud?.show("hide");
      tray?.setTooltip("Cursor Wake — esperando Juarez");
      armed = false;
      continue;
    }
    console.log(armed ? "Pedido detectado." : "Fala detectada.");
    if (armed) hud?.show("hearing");
    const pcm = await captureUntilSilence(recorder, frameMs, firstFrame);
    try {
      armed = await handleUtterance(pcm, { armed });
      armedUntil = armed ? Date.now() + armedTimeoutMs : 0;
    } catch (error) {
      console.error(`Transcricao falhou: ${error.message}`);
      hud?.show("hide");
      armed = false;
      armedUntil = 0;
    }
    if (!armed) tray?.setTooltip("Cursor Wake — esperando Juarez");
  }
}

async function testSend() {
  const newChat = args.includes("--new-chat");
  const text = args
    .slice(args.indexOf("--test-send") + 1)
    .filter((arg) => arg !== "--new-chat")
    .join(" ")
    .trim();
  if (!text && !newChat) {
    throw new Error('Uso: npm run test-send -- "refatora o serializer"');
  }
  await sendToCursor(text, {
    openAgentHotkey: Boolean(config.openAgentHotkey),
    submit: Boolean(config.submit),
    newChat,
    newChatHotkey: config.newChatHotkey,
  });
  console.log(newChat ? "Novo chat aberto; texto colado no Cursor." : "Texto colado no Cursor.");
}

async function testHud() {
  hud = startHud({ enabled: true });
  const steps = [
    ["armed", 1800],
    ["hearing", 1400],
    ["transcribing", 1400],
    ["sent", 1800],
    ["hide", 700],
  ];
  for (const [state, waitMs] of steps) {
    console.log(state);
    hud.show(state);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  hud.stop();
}

function listDevices() {
  const devices = PvRecorder.getAvailableDevices();
  devices.forEach((name, index) => {
    console.log(`${index}: ${name}`);
  });
}

try {
  const wavIndex = args.indexOf("--wav");
  const dryRun = args.includes("--dry-run");
  if (args.includes("--list-devices")) {
    listDevices();
  } else if (args.includes("--test-hud")) {
    await testHud();
  } else if (args.includes("--test-send")) {
    await testSend();
  } else if (wavIndex !== -1) {
    const wavPath = args[wavIndex + 1];
    if (!wavPath) throw new Error("Uso: node src/index.js --wav arquivo.wav --dry-run");
    await fromWav(wavPath, { dryRun });
  } else {
    await listen();
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
