import { env, pipeline } from "@huggingface/transformers";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { int16ToFloat32, peakAmplitude, prepareAudioForWhisper } from "./audio.js";
import {
  describeGpu,
  listWindowsGpus,
  pickDirectMlDeviceId,
  shouldUseGpu,
  whisperPipelineOptions,
} from "./gpu.js";
import { isHallucination } from "./transcript.js";
import { toWhisperLanguage } from "./whisper-language.js";
import {
  resolveWhisperCpp,
  shouldUseWhisperCpp,
  transcribeWithWhisperCpp,
  whisperCppAvailable,
} from "./whisper-cpp.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
env.cacheDir = join(root, "models");
env.allowLocalModels = true;

const CPU_FALLBACK_MODEL = "Xenova/whisper-small";

let transcriberKey;
let transcriberPromise;
let gpuDisabled = false;

function onProgress(info) {
  if (info.status === "progress") {
    const pct = Math.floor(info.progress ?? 0);
    if (pct !== 0 && pct !== 50 && pct < 100) return;
    const loaded = ((info.loaded ?? 0) / 1e6).toFixed(1);
    const total = ((info.total ?? 0) / 1e6).toFixed(1);
    console.log(`  ${info.file}: ${pct}% (${loaded}/${total} MB)`);
  } else if (info.status === "done") {
    console.log(`  ${info.file}: ok`);
  } else if (info.status === "ready") {
    console.log("Whisper pronto.");
  }
}

function resetTranscriber() {
  transcriberKey = null;
  transcriberPromise = null;
}

function resolveDevice(requestedDevice, requestedDeviceId) {
  if (gpuDisabled || !shouldUseGpu(requestedDevice)) {
    return { device: "cpu", deviceId: 0, label: "CPU" };
  }
  const gpus = listWindowsGpus();
  const deviceId =
    Number.isInteger(requestedDeviceId) && requestedDeviceId >= 0
      ? requestedDeviceId
      : pickDirectMlDeviceId(gpus);
  return {
    device: "dml",
    deviceId,
    label: describeGpu(gpus, deviceId),
  };
}

async function createPipeline(model, dtype, device, deviceId) {
  const options = whisperPipelineOptions({ device, deviceId, dtype });
  const where =
    device === "cpu" ? "CPU" : `GPU ${options.session_options?.executionProviders?.[0]?.deviceId ?? 0}`;
  console.log(
    `Carregando Whisper (${model}, ${dtype}, ${where}). Na primeira vez isso baixa o modelo — pode levar alguns minutos.`,
  );
  return pipeline("automatic-speech-recognition", model, {
    ...options,
    progress_callback: onProgress,
  });
}

function loadTranscriber(model, { dtype = "q8", device = "cpu", deviceId } = {}) {
  const resolved = resolveDevice(device, deviceId);
  const loadModel = resolved.device === "cpu" && gpuDisabled ? CPU_FALLBACK_MODEL : model;
  const loadDtype = resolved.device === "cpu" && gpuDisabled ? "q8" : dtype;
  const key = `${loadModel}:${loadDtype}:${resolved.device}:${resolved.deviceId}`;
  if (transcriberKey !== key) {
    transcriberKey = key;
    transcriberPromise = (async () => {
      if (resolved.device === "dml") {
        console.log(`Usando GPU: ${resolved.label} (DirectML deviceId=${resolved.deviceId})`);
        try {
          return await createPipeline(loadModel, loadDtype, "dml", resolved.deviceId);
        } catch (error) {
          console.warn(`GPU falhou no load (${error.message}). Tentando CPU com ${CPU_FALLBACK_MODEL}.`);
          gpuDisabled = true;
          return createPipeline(CPU_FALLBACK_MODEL, "q8", "cpu", 0);
        }
      }
      return createPipeline(loadModel, loadDtype, "cpu", 0);
    })();
  }
  return transcriberPromise;
}

async function runTranscribe(pcm, { model, language, dtype, device, deviceId, numBeams = 1 }) {
  const transcriber = await loadTranscriber(model, { dtype, device, deviceId });
  const peakBefore = peakAmplitude(pcm);
  const prepared = prepareAudioForWhisper(pcm);
  const peakAfter = peakAmplitude(prepared);
  if (peakAfter > peakBefore * 1.2) {
    console.log(`Audio normalizado: pico ${peakBefore.toFixed(3)} -> ${peakAfter.toFixed(3)}`);
  }
  const audio = int16ToFloat32(prepared);
  const whisperLanguage = toWhisperLanguage(language);
  const beams = Math.max(1, Number(numBeams) || 1);
  const options = {
    task: "transcribe",
    temperature: 0,
    do_sample: false,
    num_beams: beams,
    no_repeat_ngram_size: 3,
    repetition_penalty: 1.05,
  };
  if (whisperLanguage) options.language = whisperLanguage;
  const result = await transcriber(audio, options);
  if (typeof result === "string") return result.trim();
  return String(result?.text ?? "").trim();
}

export async function warmUpStt(model, options = {}) {
  const cpp = resolveWhisperCpp(options.whisperCpp);
  if (shouldUseWhisperCpp(cpp)) {
    if (whisperCppAvailable(cpp)) {
      console.log(`STT: whisper.cpp (GPU/CUDA) — modelo ${cpp.model}`);
      return;
    }
    console.warn(
      `STT: backend "whisper-cpp" pedido, mas binario/modelo nao encontrado (${cpp.binary || "sem binario"}). Usando o Whisper local.`,
    );
  }
  await loadTranscriber(model, options);
}

export async function transcribe(pcm, options) {
  const cpp = resolveWhisperCpp(options.whisperCpp);
  if (shouldUseWhisperCpp(cpp) && whisperCppAvailable(cpp)) {
    try {
      const text = await transcribeWithWhisperCpp(pcm, cpp);
      if (!isHallucination(text)) return text;
      console.warn("whisper.cpp gerou texto incoerente. Caindo pro Whisper local.");
    } catch (error) {
      console.warn(`whisper.cpp falhou (${error.message}). Caindo pro Whisper local.`);
    }
  }

  const runOnCpu = () => {
    gpuDisabled = true;
    resetTranscriber();
    return runTranscribe(pcm, {
      ...options,
      model: CPU_FALLBACK_MODEL,
      dtype: "q8",
      device: "cpu",
    });
  };

  try {
    const text = await runTranscribe(pcm, options);
    if (isHallucination(text) && shouldUseGpu(options.device) && !gpuDisabled) {
      console.warn("GPU gerou texto incoerente. Recarregando no CPU (whisper-small).");
      return runOnCpu();
    }
    return text;
  } catch (error) {
    if (gpuDisabled || options.device === "cpu") throw error;
    console.warn(`Transcricao na GPU falhou (${error.message}). Recarregando no CPU (whisper-small).`);
    return runOnCpu();
  }
}
