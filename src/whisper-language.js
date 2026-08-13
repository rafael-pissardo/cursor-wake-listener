const PORTUGUESE_ALIASES = new Set([
  "pt-br",
  "ptbr",
  "pt",
  "br",
  "pt-pt",
  "portugues",
  "português",
  "portuguese",
]);

export function toWhisperLanguage(language) {
  if (language == null) return "portuguese";
  const key = String(language).trim().toLowerCase().replace(/_/g, "-");
  if (!key || key === "auto") return null;
  if (PORTUGUESE_ALIASES.has(key)) return "portuguese";
  return key;
}
