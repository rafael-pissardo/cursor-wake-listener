import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WAKE_PHRASES,
  hasWakePrefix,
  isHallucination,
  isWakeWordOnly,
  shouldSendPrompt,
  splitNewChatIntent,
  stripWakeWord,
} from "./transcript.js";

const phrases = [
  "hey jarvis",
  "hey cursor",
  "ok cursor",
  "ok curso",
  "jarvis",
  "jarves",
  "javis",
  "cursor",
  "curso",
  "charps",
  "arps",
  "ok",
];

describe("stripWakeWord", () => {
  it("removes a leading jarvis prefix", () => {
    assert.equal(stripWakeWord("Jarvis, refatora o serializer", phrases), "refatora o serializer");
  });

  it("removes hey cursor", () => {
    assert.equal(stripWakeWord("hey cursor abre o spec", phrases), "abre o spec");
  });

  it("strips filler before the wake word", () => {
    assert.equal(stripWakeWord("É, jarvis ping", phrases), "ping");
  });

  it("leaves a prompt without a wake word", () => {
    assert.equal(stripWakeWord("corrige o teste que quebrou", phrases), "corrige o teste que quebrou");
  });
});

describe("wake detection", () => {
  it("detects Juarez as the product wake word", () => {
    assert.equal(hasWakePrefix("Juarez, lista meus prs", DEFAULT_WAKE_PHRASES), true);
    assert.equal(stripWakeWord("Juarez, lista meus prs", DEFAULT_WAKE_PHRASES), "lista meus prs");
    assert.equal(hasWakePrefix("ok lista meus prs", DEFAULT_WAKE_PHRASES), true);
    assert.equal(stripWakeWord("ok lista meus prs", DEFAULT_WAKE_PHRASES), "lista meus prs");
  });

  it("detects wake-only audio", () => {
    assert.equal(isWakeWordOnly("jarvis", phrases), true);
    assert.equal(isWakeWordOnly("Hey Cursor", phrases), true);
    assert.equal(isWakeWordOnly("jarvis, refatora", phrases), false);
  });

  it("accepts a Whisper misspelling of jarvis", () => {
    assert.equal(hasWakePrefix("jarves, ping", phrases), true);
    assert.equal(shouldSendPrompt("jarves ping agora", phrases), true);
  });

  it("rejects empty or wake-word-only audio for sending", () => {
    assert.equal(shouldSendPrompt("", phrases), false);
    assert.equal(shouldSendPrompt("jarvis", phrases), false);
    assert.equal(shouldSendPrompt("hey cursor", phrases), false);
  });

  it("accepts a real command after the wake phrase", () => {
    assert.equal(shouldSendPrompt("jarvis refatora o serializer", phrases), true);
  });

  it("finds jarvis after a few leading words", () => {
    assert.equal(shouldSendPrompt("entao jarvis ping agora", phrases), true);
    assert.equal(stripWakeWord("entao jarvis ping agora", phrases), "ping agora");
  });

  it("accepts the live miss Ok, cursor, ...", () => {
    assert.equal(
      shouldSendPrompt("Ok, cursor, me mostra uma receita de volta.", phrases),
      true,
    );
    assert.equal(
      stripWakeWord("Ok, cursor, me mostra uma receita de volta.", phrases),
      "me mostra uma receita de volta",
    );
  });

  it("accepts Ok, curso as the wake word", () => {
    assert.equal(isWakeWordOnly("Ok, curso.", phrases), true);
  });

  it("sends when Whisper drops cursor after ok", () => {
    assert.equal(
      shouldSendPrompt("Ok, que isso aí? Me mostra uma receita de bolo.", phrases),
      true,
    );
  });

  it("treats Charps as jarvis", () => {
    assert.equal(isWakeWordOnly("Charps.", phrases), true);
    assert.equal(isWakeWordOnly("Arps.", phrases), true);
  });

  it("does not send a command that never said the wake phrase", () => {
    assert.equal(hasWakePrefix("refatora o serializer", phrases), false);
    assert.equal(shouldSendPrompt("refatora o serializer", phrases), false);
  });
});

describe("fuzzy wake word", () => {
  const juarez = ["juarez"];
  const fuzzy = { maxDistance: 2 };

  it("accepts a one-letter Whisper miss like suarez", () => {
    assert.equal(hasWakePrefix("suarez lista meus prs", juarez, fuzzy), true);
    assert.equal(stripWakeWord("Suarez, lista meus prs", juarez, fuzzy), "lista meus prs");
  });

  it("accepts joares within distance 2", () => {
    assert.equal(shouldSendPrompt("joares lista meus prs", juarez, fuzzy), true);
  });

  it("does not treat java as juarez", () => {
    assert.equal(hasWakePrefix("java lista meus prs", juarez, fuzzy), false);
  });

  it("does not fuzzy-match short tokens", () => {
    assert.equal(hasWakePrefix("ok lista meus prs", juarez, fuzzy), false);
  });

  it("can be turned off", () => {
    assert.equal(hasWakePrefix("suarez lista meus prs", juarez, { maxDistance: 0 }), false);
    assert.equal(hasWakePrefix("vareis ping", juarez, { maxDistance: 0 }), false);
  });

  it("accepts the live Whisper misses Vareis and Jorais", () => {
    assert.equal(shouldSendPrompt("Vareis, ping!", juarez, fuzzy), true);
    assert.equal(stripWakeWord("Vareis, ping!", juarez, fuzzy), "ping");
    assert.equal(shouldSendPrompt("Jorais, ping!", juarez, fuzzy), true);
    assert.equal(stripWakeWord("Jorais, ping!", juarez, fuzzy), "ping");
  });

  it("does not treat juros or soares as juarez", () => {
    assert.equal(hasWakePrefix("juros ping agora", juarez, fuzzy), false);
    assert.equal(hasWakePrefix("soares lista meus prs", juarez, fuzzy), false);
  });
});

describe("splitNewChatIntent", () => {
  it("strips a leading new-chat phrase and keeps the command", () => {
    assert.deepEqual(splitNewChatIntent("em um novo chat lista meus prs abertos"), {
      newChat: true,
      command: "lista meus prs abertos",
    });
  });

  it("strips abre um chat novo", () => {
    assert.deepEqual(splitNewChatIntent("abre um chat novo corrige o teste"), {
      newChat: true,
      command: "corrige o teste",
    });
  });

  it("prefers the longest phrase over novo chat", () => {
    assert.deepEqual(splitNewChatIntent("em um novo chat lista os prs"), {
      newChat: true,
      command: "lista os prs",
    });
  });

  it("drops leftover faca before the phrase, not after", () => {
    assert.deepEqual(splitNewChatIntent("faca em um novo chat lista os prs"), {
      newChat: true,
      command: "lista os prs",
    });
    assert.deepEqual(splitNewChatIntent("em um novo chat faca uma lista de prs"), {
      newChat: true,
      command: "faca uma lista de prs",
    });
  });

  it("treats a new-chat phrase alone as open-only", () => {
    assert.deepEqual(splitNewChatIntent("novo chat"), {
      newChat: true,
      command: "",
    });
  });

  it("detects english new chat", () => {
    assert.deepEqual(splitNewChatIntent("new chat list my open prs"), {
      newChat: true,
      command: "list my open prs",
    });
  });

  it("detects tem um novo chat", () => {
    assert.deepEqual(splitNewChatIntent("tem um novo chat lista os prs"), {
      newChat: true,
      command: "lista os prs",
    });
  });

  it("detects em outro chat", () => {
    assert.deepEqual(splitNewChatIntent("em outro chat refatora o serializer"), {
      newChat: true,
      command: "refatora o serializer",
    });
  });

  it("leaves a normal command alone", () => {
    assert.deepEqual(splitNewChatIntent("lista meus prs abertos"), {
      newChat: false,
      command: "lista meus prs abertos",
    });
  });

  it("does not treat chatgpt as a new-chat phrase", () => {
    assert.deepEqual(splitNewChatIntent("chatgpt me explica esse erro"), {
      newChat: false,
      command: "chatgpt me explica esse erro",
    });
  });
});

describe("isHallucination", () => {
  it("flags repeated filler like Whisper silence output", () => {
    assert.equal(
      isHallucination("- É, é, é, é, é, é, é, é, é, é, é, é, é, é, é"),
      true,
    );
  });

  it("flags bracketed background-music tags", () => {
    assert.equal(isHallucination("[MÚSICA DE FUNDO]"), true);
  });

  it("allows a normal Portuguese command", () => {
    assert.equal(isHallucination("jarvis, refatora o serializer de paginação"), false);
    assert.equal(
      isHallucination("ok me mostra uma receita de bolo de chocolate com cobertura"),
      false,
    );
  });

  it("flags mixed-script GPU garbage", () => {
    assert.equal(
      isHallucination("adm sobieiw total onions 波 hhhzieziezie blood twitch 불 likes mexico"),
      true,
    );
  });

  it("flags a repeated-word loop", () => {
    assert.equal(isHallucination("covering covering covering nan covering coverings"), true);
  });

  it("flags a long non-Portuguese word salad", () => {
    assert.equal(
      isHallucination(
        "adm sponsors total onions blood twitch aging ancient avis continue nailed larva growing fernando drivers minority magic endless album dart efficiency snacks punch athens implementation responsibilities seating beep vegetable marginalized eclipse patience earthquake insights fashion speak rooms deformation purity battlefield trucks pretty cutting positivity",
      ),
      true,
    );
  });
});
