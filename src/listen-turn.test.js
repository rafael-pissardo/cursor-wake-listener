import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveListenTurn } from "./listen-turn.js";

const phrases = ["juarez", "okay", "ok"];
const wakeOptions = { maxDistance: 2 };
const newChatPhrases = ["em um novo chat", "novo chat"];
const params = { phrases, wakeOptions, newChatPhrases };

describe("resolveListenTurn", () => {
  it("arms on Juarez and ignores the rest of the same clip", () => {
    assert.deepEqual(
      resolveListenTurn({ ...params, armed: false, raw: "Juarez, lista meus prs" }),
      { kind: "arm" },
    );
  });

  it("arms on ok as well as Juarez", () => {
    assert.equal(resolveListenTurn({ ...params, armed: false, raw: "ok" }).kind, "arm");
    assert.equal(resolveListenTurn({ ...params, armed: false, raw: "okay" }).kind, "arm");
  });

  it("stays idle when Juarez was not said", () => {
    assert.equal(
      resolveListenTurn({ ...params, armed: false, raw: "lista meus prs" }).kind,
      "idle-ignore",
    );
  });

  it("sends the next clip without requiring Juarez again", () => {
    assert.deepEqual(resolveListenTurn({ ...params, armed: true, raw: "lista meus prs" }), {
      kind: "send",
      command: "lista meus prs",
      newChat: false,
    });
  });

  it("strips Juarez if the user repeats it on the command clip", () => {
    assert.deepEqual(
      resolveListenTurn({ ...params, armed: true, raw: "juarez ping agora" }),
      { kind: "send", command: "ping agora", newChat: false },
    );
  });

  it("keeps the door open on short noise while armed", () => {
    assert.equal(resolveListenTurn({ ...params, armed: true, raw: "eh" }).kind, "noise");
  });

  it("re-arms if the user only says Juarez again", () => {
    assert.equal(resolveListenTurn({ ...params, armed: true, raw: "juarez" }).kind, "arm");
  });
});
