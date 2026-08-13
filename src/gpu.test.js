import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeGpu,
  pickDirectMlDeviceId,
  shouldUseGpu,
  whisperPipelineOptions,
} from "./gpu.js";

const dualGpu = ["Intel(R) Arc(TM) Graphics", "NVIDIA GeForce RTX 4060 Laptop GPU"];

describe("pickDirectMlDeviceId", () => {
  it("selects the NVIDIA adapter on a hybrid laptop", () => {
    assert.equal(pickDirectMlDeviceId(dualGpu), 1);
  });

  it("falls back to adapter 0 when there is no NVIDIA GPU", () => {
    assert.equal(pickDirectMlDeviceId(["Intel(R) Arc(TM) Graphics"]), 0);
  });
});

describe("whisperPipelineOptions", () => {
  it("pins DirectML to the chosen adapter so Intel iGPU is not used", () => {
    assert.deepEqual(whisperPipelineOptions({ device: "dml", deviceId: 1, dtype: "q8" }), {
      device: "dml",
      dtype: "q8",
      session_options: {
        executionProviders: [{ name: "dml", deviceId: 1 }],
      },
    });
  });

  it("keeps a plain CPU session when GPU is off", () => {
    assert.deepEqual(whisperPipelineOptions({ device: "cpu", dtype: "q8" }), {
      device: "cpu",
      dtype: "q8",
    });
  });
});

describe("shouldUseGpu", () => {
  it("treats dml, gpu and auto as GPU requests", () => {
    assert.equal(shouldUseGpu("dml"), true);
    assert.equal(shouldUseGpu("gpu"), true);
    assert.equal(shouldUseGpu("auto"), true);
    assert.equal(shouldUseGpu("cpu"), false);
  });
});

describe("describeGpu", () => {
  it("names the selected adapter", () => {
    assert.equal(describeGpu(dualGpu, 1), "NVIDIA GeForce RTX 4060 Laptop GPU");
  });
});
