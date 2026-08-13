import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toWhisperLanguage } from "./whisper-language.js";

describe("toWhisperLanguage", () => {
  it("defaults to Portuguese", () => {
    assert.equal(toWhisperLanguage(), "portuguese");
    assert.equal(toWhisperLanguage(null), "portuguese");
  });

  it("maps PT-BR aliases to Whisper portuguese", () => {
    assert.equal(toWhisperLanguage("pt-BR"), "portuguese");
    assert.equal(toWhisperLanguage("pt_br"), "portuguese");
    assert.equal(toWhisperLanguage("PT"), "portuguese");
  });

  it("leaves other Whisper languages unchanged", () => {
    assert.equal(toWhisperLanguage("english"), "english");
    assert.equal(toWhisperLanguage("auto"), null);
  });
});
