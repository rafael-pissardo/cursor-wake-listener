import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeHudCommand, startHud } from "./hud.js";

describe("encodeHudCommand", () => {
  it("encodes each speech-feedback state as a stdin line", () => {
    assert.equal(encodeHudCommand("hearing"), "hearing\n");
    assert.equal(encodeHudCommand("transcribing"), "transcribing\n");
    assert.equal(encodeHudCommand("armed"), "armed\n");
    assert.equal(encodeHudCommand("sent"), "sent\n");
    assert.equal(encodeHudCommand("ignored"), "ignored\n");
    assert.equal(encodeHudCommand("hide"), "hide\n");
  });

  it("rejects an unknown state", () => {
    assert.throws(() => encodeHudCommand("flash"), /invalido/);
  });
});

describe("startHud", () => {
  it("writes each show() state to the overlay process stdin", () => {
    const writes = [];
    const child = {
      stdin: {
        write(chunk) {
          writes.push(chunk);
          return true;
        },
        end() {},
      },
      kill() {},
    };
    const hud = startHud({ spawnImpl: () => child });
    hud.show("hearing");
    hud.show("transcribing");
    hud.show("sent");
    assert.deepEqual(writes, ["hearing\n", "transcribing\n", "sent\n"]);
  });

  it("sends quit and stops the overlay process", () => {
    const writes = [];
    let killed = false;
    const child = {
      stdin: {
        write(chunk) {
          writes.push(chunk);
          return true;
        },
        end() {},
      },
      kill() {
        killed = true;
      },
    };
    const hud = startHud({ spawnImpl: () => child });
    hud.stop();
    assert.equal(writes.at(-1), "quit\n");
    assert.equal(killed, true);
  });

  it("does not spawn an overlay when disabled", () => {
    let spawned = false;
    const hud = startHud({
      enabled: false,
      spawnImpl: () => {
        spawned = true;
        return { stdin: { write() {}, end() {} }, kill() {} };
      },
    });
    hud.show("hearing");
    hud.stop();
    assert.equal(spawned, false);
  });
});
