import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeWavPcm16, encodeWavPcm16, resampleTo16k } from "./wav.js";

describe("encodeWavPcm16", () => {
  it("writes a 44-byte header plus 16-bit samples", () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const wav = encodeWavPcm16(pcm);
    assert.equal(wav.length, 44 + pcm.length * 2);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt32LE(24), 16_000);
    assert.equal(wav.readUInt16LE(22), 1);
  });

  it("round-trips through decodeWavPcm16", () => {
    const pcm = new Int16Array([0, 500, -500, 12345, -12345]);
    const { sampleRate, pcm: decoded } = decodeWavPcm16(encodeWavPcm16(pcm, 16_000));
    assert.equal(sampleRate, 16_000);
    assert.deepEqual([...decoded], [...pcm]);
  });

  it("honours a custom sample rate", () => {
    const wav = encodeWavPcm16(new Int16Array([1, 2, 3]), 8_000);
    assert.equal(wav.readUInt32LE(24), 8_000);
    assert.equal(decodeWavPcm16(wav).sampleRate, 8_000);
  });
});

describe("resampleTo16k", () => {
  it("returns the same buffer when already 16 kHz", () => {
    const pcm = new Int16Array([1, 2, 3]);
    assert.equal(resampleTo16k(pcm, 16_000), pcm);
  });

  it("downsamples 32 kHz to roughly half the samples", () => {
    const pcm = new Int16Array(64).fill(1000);
    assert.equal(resampleTo16k(pcm, 32_000).length, 32);
  });
});
