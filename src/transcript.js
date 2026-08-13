export function normalizeTranscript(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingFiller(text) {
  let current = text;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/^(e|eh|uh|ah|um|hmm)\s+/, "");
  }
  return current;
}

function indexOfPhrase(tokens, phraseTokens, maxDistance) {
  for (let i = 0; i <= tokens.length - phraseTokens.length; i += 1) {
    const matches = phraseTokens.every((part, offset) =>
      tokensWakeEqual(tokens[i + offset], part, maxDistance),
    );
    if (matches) return i;
  }
  return -1;
}

function levenshtein(a, b) {
  const left = String(a);
  const right = String(b);
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const prev = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) prev[j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    let previousDiagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const insert = prev[j] + 1;
      const del = prev[j - 1] + 1;
      const sub = previousDiagonal + (left[i - 1] === right[j - 1] ? 0 : 1);
      previousDiagonal = prev[j];
      prev[j] = Math.min(insert, del, sub);
    }
  }
  return prev[right.length];
}

function tokensFuzzyEqual(left, right, maxDistance) {
  if (left === right) return true;
  if (maxDistance <= 0) return false;
  if (left.length < 4 || right.length < 4) return false;
  if (Math.abs(left.length - right.length) > maxDistance) return false;
  return levenshtein(left, right) <= maxDistance;
}

function isJuarezSoundalike(token) {
  const text = String(token ?? "");
  if (text.length < 6 || text.length > 7) return false;
  return /^[jvw][aeiou]+r[aeiou]*[sz]$/.test(text);
}

function tokensWakeEqual(left, right, maxDistance) {
  if (tokensFuzzyEqual(left, right, maxDistance)) return true;
  if (maxDistance <= 0) return false;
  return isJuarezSoundalike(left) && isJuarezSoundalike(right);
}

function resolveMaxDistance(options) {
  const value = options?.maxDistance;
  if (value === 0) return 0;
  if (!Number.isFinite(value)) return 2;
  return Math.max(0, Math.trunc(value));
}

function locateWake(text, phrases = DEFAULT_WAKE_PHRASES, options) {
  const maxDistance = resolveMaxDistance(options);
  const normalized = stripLeadingFiller(normalizeTranscript(text));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const sorted = [...phrases]
    .map((phrase) => normalizeTranscript(phrase))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const head = tokens.slice(0, 10);
  for (const phrase of sorted) {
    const phraseTokens = phrase.split(/\s+/).filter(Boolean);
    const index = indexOfPhrase(head, phraseTokens, maxDistance);
    if (index === -1) continue;
    const command = tokens.slice(index + phraseTokens.length).join(" ").trim();
    return { found: true, phrase, command };
  }

  return { found: false, phrase: null, command: normalized };
}

export function stripWakeWord(text, phrases = DEFAULT_WAKE_PHRASES, options) {
  return locateWake(text, phrases, options).command;
}

export function hasWakePrefix(text, phrases = DEFAULT_WAKE_PHRASES, options) {
  return locateWake(text, phrases, options).found;
}

export function isWakeWordOnly(text, phrases = DEFAULT_WAKE_PHRASES, options) {
  const result = locateWake(text, phrases, options);
  return result.found && result.command.length === 0;
}

function stripIntentFiller(text) {
  return String(text ?? "")
    .replace(/^(faca|faz|faco|para mim|pra mim|me faz|me faca)(?:\s+|$)/u, "")
    .trim();
}

export function splitNewChatIntent(text, phrases = DEFAULT_NEW_CHAT_PHRASES) {
  const normalized = stripLeadingFiller(normalizeTranscript(text));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const sorted = [...phrases]
    .map((phrase) => normalizeTranscript(phrase))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const phrase of sorted) {
    const phraseTokens = phrase.split(/\s+/).filter(Boolean);
    const index = indexOfPhrase(tokens, phraseTokens, 0);
    if (index === -1) continue;
    const before = stripIntentFiller(tokens.slice(0, index).join(" "));
    const after = tokens.slice(index + phraseTokens.length).join(" ").trim();
    const command = [before, after].filter(Boolean).join(" ");
    return { newChat: true, command };
  }

  return { newChat: false, command: normalized };
}

function tokenizeTranscript(text) {
  return normalizeTranscript(text).split(/\s+/).filter(Boolean);
}

const PORTUGUESE_FUNCTION_WORDS = new Set([
  "a",
  "ao",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "ela",
  "ele",
  "em",
  "eu",
  "foi",
  "isso",
  "ja",
  "mais",
  "mas",
  "me",
  "meu",
  "minha",
  "na",
  "nao",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelo",
  "por",
  "pra",
  "que",
  "se",
  "sem",
  "ser",
  "seu",
  "sua",
  "um",
  "uma",
  "voce",
]);

function hasForeignScripts(text) {
  return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Thai}]/u.test(
    String(text ?? ""),
  );
}

function hasRepeatedLoop(tokens) {
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i] && tokens[i] === tokens[i + 1] && tokens[i] === tokens[i + 2]) {
      return true;
    }
  }
  return false;
}

function portugueseFunctionCount(tokens) {
  let count = 0;
  for (const token of tokens) {
    if (PORTUGUESE_FUNCTION_WORDS.has(token)) count += 1;
  }
  return count;
}

export function isHallucination(text) {
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return true;
  if (hasForeignScripts(trimmed)) return true;
  if (
    /inscreva-se|legendas? (pela|por)|thanks for watching|subtitles?|♪|\[m[uú]sica|[múu]sica de fundo|^música\.?$/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  const tokens = tokenizeTranscript(trimmed);
  if (hasRepeatedLoop(tokens)) return true;
  if (tokens.length < 6) return false;
  const unique = new Set(tokens);
  if (unique.size === 1) return true;
  if (unique.size <= 2 && tokens.length >= 8) return true;

  let topCount = 0;
  for (const token of unique) {
    let count = 0;
    for (const item of tokens) {
      if (item === token) count += 1;
    }
    if (count > topCount) topCount = count;
  }
  if (topCount / tokens.length >= 0.7) return true;
  if (tokens.length >= 20 && portugueseFunctionCount(tokens) < 2) return true;
  return false;
}

export const DEFAULT_NEW_CHAT_PHRASES = [
  "em um novo chat",
  "em um chat novo",
  "abre um novo chat",
  "abra um novo chat",
  "abre um chat novo",
  "abra um chat novo",
  "tem um novo chat",
  "num novo chat",
  "em outro chat",
  "outro chat",
  "chat novo",
  "novo chat",
  "new chat",
  "novo cha",
];

export const DEFAULT_WAKE_PHRASES = [
  "juarez",
  "okay",
  "ok",
];
