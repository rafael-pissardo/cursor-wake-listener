import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  buildWhisperCppArgs,
  parseWhisperCppOutput,
  resolveWhisperCpp,
  shouldUseWhisperCpp,
  transcribeWithWhisperCpp,
  whisperCppAvailable,
} from "./whisper-cpp.js";

describe("resolveWhisperCpp", () => {
  it("fills defaults for an empty config", () => {
    assert.deepEqual(resolveWhisperCpp(), {
      backend: "auto",
      binary: "",
      model: "",
      language: "pt",
      extraArgs: [],
    });
  });

  it("ignores a non-array extraArgs", () => {
    assert.deepEqual(resolveWhisperCpp({ extraArgs: "bogus" }).extraArgs, []);
  });
});

describe("whisperCppAvailable", () => {
  const cfg = { binary: "whisper-cli.exe", model: "ggml.bin" };

  it("is true only when binary and model exist", () => {
    assert.equal(whisperCppAvailable(cfg, () => true), true);
    assert.equal(whisperCppAvailable(cfg, () => false), false);
  });

  it("is false when binary or model is unset", () => {
    assert.equal(whisperCppAvailable({ binary: "", model: "ggml.bin" }, () => true), false);
  });
});

describe("shouldUseWhisperCpp", () => {
  it("never uses whisper.cpp when backend is transformers", () => {
    assert.equal(
      shouldUseWhisperCpp({ backend: "transformers", binary: "a", model: "b" }, () => true),
      false,
    );
  });

  it("always uses whisper.cpp when backend is whisper-cpp", () => {
    assert.equal(shouldUseWhisperCpp({ backend: "whisper-cpp" }, () => false), true);
  });

  it("auto uses whisper.cpp only when files are present", () => {
    const cfg = { backend: "auto", binary: "a", model: "b" };
    assert.equal(shouldUseWhisperCpp(cfg, () => true), true);
    assert.equal(shouldUseWhisperCpp(cfg, () => false), false);
  });
});

describe("buildWhisperCppArgs", () => {
  it("builds a no-timestamp CLI invocation", () => {
    assert.deepEqual(
      buildWhisperCppArgs({ model: "ggml.bin", wavPath: "a.wav", language: "pt" }),
      ["-m", "ggml.bin", "-f", "a.wav", "-nt", "-l", "pt"],
    );
  });

  it("appends extra args after the defaults", () => {
    assert.deepEqual(
      buildWhisperCppArgs({
        model: "ggml.bin",
        wavPath: "a.wav",
        language: "auto",
        extraArgs: ["-t", "8"],
      }),
      ["-m", "ggml.bin", "-f", "a.wav", "-nt", "-l", "auto", "-t", "8"],
    );
  });
});

describe("parseWhisperCppOutput", () => {
  it("joins transcription lines and collapses whitespace", () => {
    assert.equal(parseWhisperCppOutput("  lista meus prs \n abertos  \n"), "lista meus prs abertos");
  });

  it("strips leftover [timestamp] prefixes", () => {
    assert.equal(
      parseWhisperCppOutput("[00:00:00.000 --> 00:00:02.000]  juarez ping"),
      "juarez ping",
    );
  });

  it("is empty for blank output", () => {
    assert.equal(parseWhisperCppOutput(""), "");
    assert.equal(parseWhisperCppOutput(null), "");
  });
});

function fakeSpawn({ stdout = "", stderr = "", code = 0, error } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (error) {
        child.emit("error", error);
        return;
      }
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", code);
    });
    return child;
  };
}

describe("transcribeWithWhisperCpp", () => {
  const cfg = { binary: "whisper-cli.exe", model: "ggml.bin", language: "pt", extraArgs: [] };
  const pcm = new Int16Array([0, 1000, -1000]);

  it("returns the parsed transcription on success", async () => {
    const text = await transcribeWithWhisperCpp(pcm, cfg, {
      spawnImpl: fakeSpawn({ stdout: "lista meus prs\n" }),
    });
    assert.equal(text, "lista meus prs");
  });

  it("rejects with stderr when the binary exits non-zero", async () => {
    await assert.rejects(
      transcribeWithWhisperCpp(pcm, cfg, {
        spawnImpl: fakeSpawn({ stderr: "failed to load model", code: 1 }),
      }),
      /failed to load model/,
    );
  });

  it("propagates a spawn error", async () => {
    await assert.rejects(
      transcribeWithWhisperCpp(pcm, cfg, {
        spawnImpl: fakeSpawn({ error: new Error("ENOENT") }),
      }),
      /ENOENT/,
    );
  });
});
