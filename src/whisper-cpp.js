import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWavPcm16 } from "./wav.js";

export function resolveWhisperCpp(config = {}) {
  return {
    backend: config.backend ?? "auto",
    binary: config.binary ?? "",
    model: config.model ?? "",
    language: config.language ?? "pt",
    extraArgs: Array.isArray(config.extraArgs) ? config.extraArgs : [],
  };
}

export function whisperCppAvailable(cfg, exists = existsSync) {
  return (
    Boolean(cfg.binary) &&
    Boolean(cfg.model) &&
    exists(cfg.binary) &&
    exists(cfg.model)
  );
}

export function shouldUseWhisperCpp(cfg, exists = existsSync) {
  if (cfg.backend === "transformers") return false;
  if (cfg.backend === "whisper-cpp") return true;
  return whisperCppAvailable(cfg, exists);
}

export function buildWhisperCppArgs({ model, wavPath, language = "pt", extraArgs = [] }) {
  const args = ["-m", model, "-f", wavPath, "-nt"];
  if (language) args.push("-l", language);
  return [...args, ...extraArgs];
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
