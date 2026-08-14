import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWavPcm16 } from "./wav.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8080";

let managedServer = null;

export function resolveWhisperCpp(config = {}) {
  return {
    backend: config.backend ?? "auto",
    mode: config.mode ?? "auto",
    binary: config.binary ?? "",
    model: config.model ?? "",
    language: config.language ?? "pt",
    extraArgs: Array.isArray(config.extraArgs) ? config.extraArgs : [],
    serverUrl: config.serverUrl ?? DEFAULT_SERVER_URL,
    serverBinary: config.serverBinary ?? "",
    serverExtraArgs: Array.isArray(config.serverExtraArgs) ? config.serverExtraArgs : [],
    serverReadyTimeoutMs: Number(config.serverReadyTimeoutMs ?? 120_000),
  };
}

export function whisperCppCliAvailable(cfg, exists = existsSync) {
  return Boolean(cfg.binary) && Boolean(cfg.model) && exists(cfg.binary) && exists(cfg.model);
}

export function whisperCppManagedServerAvailable(cfg, exists = existsSync) {
  return (
    Boolean(cfg.serverBinary) &&
    Boolean(cfg.model) &&
    exists(cfg.serverBinary) &&
    exists(cfg.model)
  );
}

export function whisperCppAvailable(cfg, exists = existsSync) {
  return whisperCppCliAvailable(cfg, exists) || whisperCppManagedServerAvailable(cfg, exists);
}

export function shouldUseWhisperCpp(cfg, exists = existsSync) {
  if (cfg.backend === "transformers") return false;
  if (cfg.backend === "whisper-cpp") return true;
  if (String(cfg.mode ?? "auto").toLowerCase() === "server") return true;
  return whisperCppAvailable(cfg, exists);
}

export function preferWhisperServer(cfg, exists = existsSync) {
  const mode = String(cfg.mode ?? "auto").toLowerCase();
  if (mode === "cli") return false;
  if (mode === "server") return true;
  return whisperCppManagedServerAvailable(cfg, exists);
}

export function buildWhisperCppArgs({ model, wavPath, language = "pt", extraArgs = [] }) {
  const args = ["-m", model, "-f", wavPath, "-nt"];
  if (language) args.push("-l", language);
  return [...args, ...extraArgs];
}

export function buildWhisperServerArgs(cfg) {
  const { host, port } = parseServerUrl(cfg.serverUrl);
  const args = ["-m", cfg.model, "--host", host, "--port", String(port)];
  if (cfg.language) args.push("-l", cfg.language);
  return [...args, ...(cfg.serverExtraArgs ?? [])];
}

export function parseServerUrl(url = DEFAULT_SERVER_URL) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "127.0.0.1",
      port: Number(parsed.port) || 8080,
      origin: `${parsed.protocol}//${parsed.hostname || "127.0.0.1"}:${Number(parsed.port) || 8080}`,
    };
  } catch {
    return { host: "127.0.0.1", port: 8080, origin: DEFAULT_SERVER_URL };
  }
}

export function parseWhisperCppOutput(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseWhisperServerResponse(body, contentType = "") {
  const text = String(body ?? "").trim();
  if (!text) return "";
  const looksJson = /json/i.test(contentType) || text.startsWith("{") || text.startsWith("[");
  if (looksJson) {
    try {
      const data = JSON.parse(text);
      if (typeof data?.text === "string") return data.text.trim();
      if (typeof data?.transcription === "string") return data.transcription.trim();
      if (Array.isArray(data?.transcription) ) {
        return data.transcription.map((part) => part?.text ?? part).join(" ").trim();
      }
    } catch {
      /* fall through to plain text */
    }
  }
  return parseWhisperCppOutput(text);
}

export function buildInferenceMultipart(wavBuffer, { language = "pt", temperature = "0.0" } = {}) {
  const boundary = `----JuarezBoundary${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const fields = {
    temperature: String(temperature),
    response_format: "json",
    language: String(language ?? "pt"),
  };
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
  );
  chunks.push(Buffer.from(wavBuffer));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function runBinary(binary, args, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `whisper.cpp saiu com codigo ${code}`));
    });
  });
}

export async function probeWhisperServer(url = DEFAULT_SERVER_URL, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  const { origin } = parseServerUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(origin, { method: "GET", signal: controller.signal });
    return response.ok || response.status === 404 || response.status === 405;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForWhisperServer(url, {
  timeoutMs = 120_000,
  intervalMs = 500,
  probe = probeWhisperServer,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function startManagedWhisperServer(cfg, {
  spawnImpl = spawn,
  probe = probeWhisperServer,
  wait = waitForWhisperServer,
  exists = existsSync,
} = {}) {
  if (managedServer?.child) return managedServer;
  if (await probe(cfg.serverUrl)) {
    managedServer = { child: null, url: cfg.serverUrl, external: true };
    return managedServer;
  }
  if (!whisperCppManagedServerAvailable(cfg, exists)) {
    throw new Error("whisper-server: aponte whisperCppServerBinary e whisperCppModel");
  }

  const args = buildWhisperServerArgs(cfg);
  console.log(`Subindo whisper-server: ${cfg.serverBinary} ${args.join(" ")}`);
  const child = spawnImpl(cfg.serverBinary, args, {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("error", (error) => {
    console.error(`whisper-server: ${error.message}`);
  });
  child.on("exit", (code) => {
    if (managedServer?.child === child) managedServer = null;
    if (code && code !== 0) {
      console.warn(`whisper-server encerrou com codigo ${code}${stderr ? `: ${stderr.trim()}` : ""}`);
    }
  });

  managedServer = { child, url: cfg.serverUrl, external: false };
  const ready = await wait(cfg.serverUrl, {
    timeoutMs: cfg.serverReadyTimeoutMs,
    probe,
  });
  if (!ready) {
    stopManagedWhisperServer();
    throw new Error(
      `whisper-server nao ficou pronto em ${cfg.serverReadyTimeoutMs}ms${stderr ? `: ${stderr.trim()}` : ""}`,
    );
  }
  return managedServer;
}

export function stopManagedWhisperServer() {
  const current = managedServer;
  managedServer = null;
  if (!current?.child || current.external) return;
  try {
    current.child.kill();
  } catch {
    /* already dead */
  }
}

export function getManagedWhisperServer() {
  return managedServer;
}

export async function ensureWhisperServer(cfg, deps = {}) {
  if (await (deps.probe ?? probeWhisperServer)(cfg.serverUrl, deps)) {
    managedServer = managedServer ?? { child: null, url: cfg.serverUrl, external: true };
    return managedServer;
  }
  if (whisperCppManagedServerAvailable(cfg, deps.exists ?? existsSync)) {
    return startManagedWhisperServer(cfg, deps);
  }
  throw new Error(`whisper-server indisponivel em ${cfg.serverUrl}`);
}

export async function transcribeWithWhisperServer(pcm, cfg, { fetchImpl = fetch } = {}) {
  const wav = encodeWavPcm16(pcm);
  const { body, contentType } = buildInferenceMultipart(wav, { language: cfg.language });
  const { origin } = parseServerUrl(cfg.serverUrl);
  const response = await fetchImpl(`${origin}/inference`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw.trim() || `whisper-server HTTP ${response.status}`);
  }
  return parseWhisperServerResponse(raw, response.headers?.get?.("content-type") ?? "");
}

export async function transcribeWithWhisperCpp(pcm, cfg, { spawnImpl = spawn } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "juarez-cpp-"));
  const wavPath = join(dir, "audio.wav");
  try {
    await writeFile(wavPath, encodeWavPcm16(pcm));
    const args = buildWhisperCppArgs({
      model: cfg.model,
      wavPath,
      language: cfg.language,
      extraArgs: cfg.extraArgs,
    });
    const stdout = await runBinary(cfg.binary, args, spawnImpl);
    return parseWhisperCppOutput(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function transcribeViaWhisperCpp(pcm, cfg, deps = {}) {
  const wantServer = preferWhisperServer(cfg, deps.exists ?? existsSync);
  if (wantServer) {
    try {
      await ensureWhisperServer(cfg, deps);
      return await transcribeWithWhisperServer(pcm, cfg, deps);
    } catch (error) {
      if (String(cfg.mode).toLowerCase() === "server") throw error;
      if (!whisperCppCliAvailable(cfg, deps.exists ?? existsSync)) throw error;
      console.warn(`whisper-server falhou (${error.message}). Tentando whisper-cli.`);
    }
  }
  if (!whisperCppCliAvailable(cfg, deps.exists ?? existsSync)) {
    throw new Error("whisper.cpp: binario/modelo do CLI nao encontrados");
  }
  return transcribeWithWhisperCpp(pcm, cfg, deps);
}
