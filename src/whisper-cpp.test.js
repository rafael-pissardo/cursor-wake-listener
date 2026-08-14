import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  buildInferenceMultipart,
  buildWhisperCppArgs,
  buildWhisperServerArgs,
  getManagedWhisperServer,
  parseServerUrl,
  parseWhisperCppOutput,
  parseWhisperServerResponse,
  preferWhisperServer,
  resolveWhisperCpp,
  shouldUseWhisperCpp,
  startManagedWhisperServer,
  stopManagedWhisperServer,
  transcribeViaWhisperCpp,
  transcribeWithWhisperCpp,
  transcribeWithWhisperServer,
  whisperCppAvailable,
  whisperCppCliAvailable,
  whisperCppManagedServerAvailable,
} from "./whisper-cpp.js";

describe("resolveWhisperCpp", () => {
  it("fills defaults for an empty config", () => {
    assert.deepEqual(resolveWhisperCpp(), {
      backend: "auto",
      mode: "auto",
      binary: "",
      model: "",
      language: "pt",
      extraArgs: [],
      serverUrl: "http://127.0.0.1:8080",
      serverBinary: "",
      serverExtraArgs: [],
      serverReadyTimeoutMs: 120_000,
    });
  });

  it("ignores a non-array extraArgs", () => {
    assert.deepEqual(resolveWhisperCpp({ extraArgs: "bogus" }).extraArgs, []);
  });
});

describe("availability helpers", () => {
  const cli = { binary: "whisper-cli.exe", model: "ggml.bin" };
  const managed = { serverBinary: "whisper-server.exe", model: "ggml.bin" };

  it("detects CLI and managed server separately", () => {
    assert.equal(whisperCppCliAvailable(cli, () => true), true);
    assert.equal(whisperCppManagedServerAvailable(managed, () => true), true);
    assert.equal(whisperCppAvailable({ ...cli, ...managed }, () => true), true);
    assert.equal(whisperCppCliAvailable(cli, () => false), false);
  });

  it("auto uses whisper.cpp when either path is present", () => {
    assert.equal(shouldUseWhisperCpp({ backend: "auto", ...cli }, () => true), true);
    assert.equal(shouldUseWhisperCpp({ backend: "auto", ...managed }, () => true), true);
    assert.equal(shouldUseWhisperCpp({ backend: "auto" }, () => true), false);
  });

  it("mode=server always opts in", () => {
    assert.equal(shouldUseWhisperCpp({ backend: "auto", mode: "server" }, () => false), true);
  });

  it("never uses whisper.cpp when backend is transformers", () => {
    assert.equal(
      shouldUseWhisperCpp({ backend: "transformers", binary: "a", model: "b" }, () => true),
      false,
    );
  });
});

describe("preferWhisperServer", () => {
  it("prefers server in server mode and when a managed binary exists", () => {
    assert.equal(preferWhisperServer({ mode: "server" }), true);
    assert.equal(
      preferWhisperServer(
        { mode: "auto", serverBinary: "whisper-server.exe", model: "ggml.bin" },
        () => true,
      ),
      true,
    );
  });

  it("stays on CLI when mode is cli or only the CLI binary is set", () => {
    assert.equal(
      preferWhisperServer({ mode: "cli", serverBinary: "x", model: "y" }, () => true),
      false,
    );
    assert.equal(
      preferWhisperServer({ mode: "auto", binary: "cli.exe", model: "y" }, () => false),
      false,
    );
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

describe("buildWhisperServerArgs", () => {
  it("binds host/port from the server URL", () => {
    assert.deepEqual(
      buildWhisperServerArgs({
        model: "ggml.bin",
        language: "pt",
        serverUrl: "http://127.0.0.1:9090",
        serverExtraArgs: ["-t", "4"],
      }),
      ["-m", "ggml.bin", "--host", "127.0.0.1", "--port", "9090", "-l", "pt", "-t", "4"],
    );
  });
});

describe("parseServerUrl", () => {
  it("defaults missing port to 8080", () => {
    assert.deepEqual(parseServerUrl("http://127.0.0.1"), {
      host: "127.0.0.1",
      port: 8080,
      origin: "http://127.0.0.1:8080",
    });
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

describe("parseWhisperServerResponse", () => {
  it("reads the OpenAI-style text field", () => {
    assert.equal(
      parseWhisperServerResponse(JSON.stringify({ text: " lista meus prs " }), "application/json"),
      "lista meus prs",
    );
  });

  it("falls back to plain text", () => {
    assert.equal(parseWhisperServerResponse("juarez ping\n"), "juarez ping");
  });
});

describe("buildInferenceMultipart", () => {
  it("includes the wav bytes and json response format", () => {
    const wav = Buffer.from([1, 2, 3, 4]);
    const { body, contentType } = buildInferenceMultipart(wav, { language: "pt" });
    assert.match(contentType, /multipart\/form-data; boundary=/);
    assert.ok(body.includes(Buffer.from('name="response_format"')));
    assert.ok(body.includes(Buffer.from("json")));
    assert.ok(body.includes(wav));
    assert.ok(body.includes(Buffer.from('filename="audio.wav"')));
  });
});

function fakeSpawn({ stdout = "", stderr = "", code = 0, error } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("exit", 0);
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

describe("transcribeWithWhisperServer", () => {
  const cfg = { serverUrl: "http://127.0.0.1:8080", language: "pt" };
  const pcm = new Int16Array([0, 1000, -1000]);

  it("posts multipart audio and returns the text field", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ text: "lista meus prs" }),
      };
    };
    const text = await transcribeWithWhisperServer(pcm, cfg, { fetchImpl });
    assert.equal(text, "lista meus prs");
    assert.equal(seen.url, "http://127.0.0.1:8080/inference");
    assert.equal(seen.init.method, "POST");
    assert.match(seen.init.headers["Content-Type"], /multipart\/form-data/);
  });

  it("rejects on HTTP errors", async () => {
    await assert.rejects(
      transcribeWithWhisperServer(pcm, cfg, {
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          headers: { get: () => "text/plain" },
          text: async () => "boom",
        }),
      }),
      /boom/,
    );
  });
});

describe("managed whisper-server lifecycle", () => {
  beforeEach(() => stopManagedWhisperServer());
  afterEach(() => stopManagedWhisperServer());

  it("reuses an already-running external server", async () => {
    const handle = await startManagedWhisperServer(
      { serverUrl: "http://127.0.0.1:8080", serverBinary: "", model: "" },
      { probe: async () => true },
    );
    assert.equal(handle.external, true);
    assert.equal(getManagedWhisperServer().external, true);
  });

  it("spawns whisper-server when nothing is listening", async () => {
    let spawned = null;
    const spawnImpl = (binary, args) => {
      spawned = { binary, args };
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        child.emit("exit", 0);
      };
      return child;
    };
    const cfg = {
      serverUrl: "http://127.0.0.1:8080",
      serverBinary: "whisper-server.exe",
      model: "ggml.bin",
      language: "pt",
      serverExtraArgs: ["-t", "4"],
      serverReadyTimeoutMs: 1000,
    };
    const handle = await startManagedWhisperServer(cfg, {
      spawnImpl,
      probe: async () => false,
      wait: async () => true,
      exists: () => true,
    });
    assert.equal(handle.external, false);
    assert.equal(spawned.binary, "whisper-server.exe");
    assert.deepEqual(spawned.args, [
      "-m",
      "ggml.bin",
      "--host",
      "127.0.0.1",
      "--port",
      "8080",
      "-l",
      "pt",
      "-t",
      "4",
    ]);
    stopManagedWhisperServer();
    assert.equal(getManagedWhisperServer(), null);
  });
});

describe("transcribeViaWhisperCpp", () => {
  const pcm = new Int16Array([0, 1000, -1000]);

  afterEach(() => stopManagedWhisperServer());

  it("uses the server when mode prefers it", async () => {
    const cfg = {
      mode: "server",
      serverUrl: "http://127.0.0.1:8080",
      language: "pt",
      binary: "",
      model: "",
    };
    const text = await transcribeViaWhisperCpp(pcm, cfg, {
      probe: async () => true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ text: "via server" }),
      }),
    });
    assert.equal(text, "via server");
  });

  it("falls back to CLI when server fails in auto mode", async () => {
    const cfg = {
      mode: "auto",
      serverUrl: "http://127.0.0.1:8080",
      serverBinary: "whisper-server.exe",
      binary: "whisper-cli.exe",
      model: "ggml.bin",
      language: "pt",
      extraArgs: [],
    };
    const text = await transcribeViaWhisperCpp(pcm, cfg, {
      exists: () => true,
      probe: async () => false,
      wait: async () => false,
      spawnImpl: fakeSpawn({ stdout: "via cli" }),
    });
    assert.equal(text, "via cli");
  });

  it("uses CLI directly when mode is cli", async () => {
    const text = await transcribeViaWhisperCpp(
      pcm,
      {
        mode: "cli",
        binary: "whisper-cli.exe",
        model: "ggml.bin",
        language: "pt",
        extraArgs: [],
      },
      {
        exists: () => true,
        spawnImpl: fakeSpawn({ stdout: "cli only" }),
      },
    );
    assert.equal(text, "cli only");
  });
});
