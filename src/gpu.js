import { execFileSync } from "node:child_process";

const NVIDIA_RE = /nvidia|geforce|rtx/i;

export function pickDirectMlDeviceId(gpuNames, { prefer = NVIDIA_RE } = {}) {
  const names = (gpuNames ?? []).map((name) => String(name).trim()).filter(Boolean);
  const index = names.findIndex((name) => prefer.test(name));
  return index >= 0 ? index : 0;
}

export function describeGpu(gpuNames, deviceId) {
  const names = (gpuNames ?? []).map((name) => String(name).trim()).filter(Boolean);
  return names[deviceId] ?? names[0] ?? "GPU";
}

export function whisperPipelineOptions({ device = "cpu", deviceId = 0, dtype = "q8" } = {}) {
  if (device === "cpu") {
    return { device: "cpu", dtype };
  }
  return {
    device: "dml",
    dtype,
    session_options: {
      executionProviders: [{ name: "dml", deviceId: Number(deviceId) || 0 }],
    },
  };
}

export function shouldUseGpu(device) {
  const value = String(device ?? "dml").toLowerCase();
  return value === "dml" || value === "gpu" || value === "auto";
}

export function listWindowsGpus() {
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
