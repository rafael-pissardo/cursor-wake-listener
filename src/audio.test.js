import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  captureShouldStop,
  concatInt16,
  createNoiseGate,
  peakAmplitude,
  prepareAudioForWhisper,
  rms,
  thresholdFromProbe,
} from "./audio.js";

describe("rms", () => {
  it("is zero for silence", () => {
    assert.equal(rms(new Int16Array(512)), 0);
  });

  it("is high for a full-scale tone", () => {
    const pcm = new Int16Array(8).fill(30000);
    assert.ok(rms(pcm) > 0.8);
  });
});

describe("concatInt16", () => {
  it("joins frames in order", () => {
    const joined = concatInt16([new Int16Array([1, 2]), new Int16Array([3])]);
    assert.deepEqual([...joined], [1, 2, 3]);
  });
});

describe("captureShouldStop", () => {
  it("stops after max duration", () => {
    assert.equal(
      captureShouldStop({
        elapsedMs: 12_000,
        silenceMs: 0,
        silenceThresholdMs: 900,
        maxCaptureMs: 12_000,
        heardSpeech: true,
        currentRms: 0.2,
        speechRmsThreshold: 0.018,
      }),
      "max",
    );
  });

  it("does not stop before the minimum capture time", () => {
    assert.equal(
      captureShouldStop({
        elapsedMs: 200,
        silenceMs: 200,
        silenceThresholdMs: 900,
        minCaptureMs: 400,
        maxCaptureMs: 12_000,
        heardSpeech: true,
        currentRms: 0.001,
        speechRmsThreshold: 0.018,
      }),
      null,
    );
  });

  it("stops on trailing silence after speech", () => {
    assert.equal(
      captureShouldStop({
        elapsedMs: 1800,
        silenceMs: 900,
        silenceThresholdMs: 900,
        maxCaptureMs: 12_000,
        heardSpeech: true,
        currentRms: 0.002,
        speechRmsThreshold: 0.018,
      }),
      "silence",
    );
  });

  it("keeps recording while the user is speaking", () => {
    assert.equal(
      captureShouldStop({
        elapsedMs: 800,
        silenceMs: 0,
        silenceThresholdMs: 900,
        maxCaptureMs: 12_000,
        heardSpeech: true,
        currentRms: 0.1,
        speechRmsThreshold: 0.018,
      }),
      null,
    );
  });
});

describe("createNoiseGate", () => {
  it("stays at the minimum until it has samples", () => {
    const gate = createNoiseGate({ minThreshold: 0.012 });
    assert.equal(gate.threshold(), 0.012);
  });

  it("raises the threshold above a noisy floor", () => {
    const gate = createNoiseGate({ minThreshold: 0.012, maxThreshold: 0.045 });
    for (let i = 0; i < 40; i += 1) gate.observe(0.01);
    assert.ok(gate.threshold() > 0.012);
    assert.ok(gate.threshold() < 0.045);
  });
});

describe("thresholdFromProbe", () => {
  it("uses a low fallback when the probe is silence", () => {
    assert.equal(thresholdFromProbe({ avg: 0, peak: 0 }), 0.001);
  });

  it("stays below the old 0.018 cutoff for a quiet USB mic", () => {
    const value = thresholdFromProbe({ avg: 0, peak: 0.0002 });
    assert.ok(value <= 0.001);
    assert.ok(0.0025 > value);
  });
});

describe("prepareAudioForWhisper", () => {
  it("boosts a quiet USB-level utterance toward Whisper volume", () => {
    const quiet = new Int16Array(32).fill(800);
    const prepared = prepareAudioForWhisper(quiet);
    assert.ok(peakAmplitude(prepared) > 0.7);
    assert.ok(peakAmplitude(prepared) <= 0.86);
  });

  it("does not boost silence", () => {
    const silence = new Int16Array(32);
    const prepared = prepareAudioForWhisper(silence);
    assert.equal(peakAmplitude(prepared), 0);
  });

  it("pads silence around the speech so Whisper does not clip the edges", () => {
    const speech = new Int16Array(8).fill(20000);
    const prepared = prepareAudioForWhisper(speech);
    const pad = 16_000 * 0.3;
    assert.equal(prepared.length, speech.length + pad * 2);
    assert.equal(prepared[0], 0);
    assert.equal(prepared[prepared.length - 1], 0);
  });
});
