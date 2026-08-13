import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEmptyTokenError } from "./stt-errors.js";

describe("isEmptyTokenError", () => {
  it("matches the DirectML fp16 Whisper crash", () => {
    assert.equal(isEmptyTokenError(new Error("token_ids must be a non-empty array of integers.")), true);
  });

  it("ignores unrelated failures", () => {
    assert.equal(isEmptyTokenError(new Error("GPU falhou")), false);
  });
});
