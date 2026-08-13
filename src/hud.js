import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ps1 = join(dirname(fileURLToPath(import.meta.url)), "hud.ps1");

const HUD_STATES = new Set([
  "hearing",
  "transcribing",
  "armed",
  "sent",
  "hide",
  "quit",
]);

export function encodeHudCommand(state) {
  if (!HUD_STATES.has(state)) {
    throw new Error(`Estado de HUD invalido: ${state}`);
  }
  return `${state}\n`;
}

function noopHud() {
  return {
    show() {},
    stop() {},
  };
}

export function startHud({
  enabled = true,
  spawnImpl = spawn,
  scriptPath = ps1,
} = {}) {
  if (!enabled) return noopHud();

  const child = spawnImpl(
    "powershell.exe",
    ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
  );
  child.on?.("error", (error) => {
    console.error(`HUD: ${error.message}`);
  });

  const write = (state) => {
    try {
      child.stdin.write(encodeHudCommand(state));
    } catch {
      /* overlay already gone */
    }
  };

  return {
    show(state) {
      write(state);
    },
    stop() {
      write("quit");
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      try {
        child.kill();
      } catch {
        /* already dead */
      }
    },
  };
}
