import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ps1 = join(dirname(fileURLToPath(import.meta.url)), "send-to-cursor.ps1");

function runPowershell(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ...args],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stdout.trim()) console.log(stdout.trim());
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell saiu com codigo ${code}`));
    });
  });
}

export async function sendToCursor(text, { openAgentHotkey, submit, newChat = false, newChatHotkey = "palette" }) {
  const dir = await mkdtemp(join(tmpdir(), "cursor-wake-"));
  const promptFile = join(dir, "prompt.txt");
  try {
    await writeFile(promptFile, text ?? "", "utf8");
    await runPowershell([
      ps1,
      promptFile,
      openAgentHotkey ? "1" : "0",
      submit ? "1" : "0",
      newChat ? "1" : "0",
      newChatHotkey || "palette",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
