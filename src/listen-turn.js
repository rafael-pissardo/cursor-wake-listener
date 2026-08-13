import {
  hasWakePrefix,
  isHallucination,
  isWakeWordOnly,
  splitNewChatIntent,
  stripWakeWord,
} from "./transcript.js";

export function resolveListenTurn({
  armed,
  raw,
  phrases,
  wakeOptions,
  newChatPhrases,
}) {
  if (isHallucination(raw)) {
    return { kind: armed ? "noise" : "idle-ignore" };
  }

  const heardWake = hasWakePrefix(raw, phrases, wakeOptions);
  const prompt = stripWakeWord(raw, phrases, wakeOptions);
  const { newChat, command } = splitNewChatIntent(prompt, newChatPhrases);
  const wakeOnly =
    isWakeWordOnly(raw, phrases, wakeOptions) ||
    (heardWake && prompt.length < 3 && !newChat);

  if (!armed) {
    if (heardWake) return { kind: "arm" };
    return { kind: "idle-ignore" };
  }

  if (wakeOnly) return { kind: "arm" };
  if (command.length >= 3 || newChat) {
    return { kind: "send", command, newChat };
  }
  return { kind: "noise" };
}
