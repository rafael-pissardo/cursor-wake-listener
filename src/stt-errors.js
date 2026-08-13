export function isEmptyTokenError(error) {
  return /token_ids must be a non-empty array/i.test(String(error?.message ?? error ?? ""));
}
