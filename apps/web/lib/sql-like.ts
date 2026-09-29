export const MAX_SEARCH_QUERY = 80;

export function clipSearchQuery(raw: string): string {
  return raw.trim().slice(0, MAX_SEARCH_QUERY);
}

export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function containsIlikePattern(raw: string): string {
  return `%${escapeIlikePattern(raw)}%`;
}

export function prefixIlikePattern(raw: string): string {
  return `${escapeIlikePattern(raw)}%`;
}

export function plzPrefix(raw: unknown, digits = 3): string | null {
  if (typeof raw !== "string") return null;
  const prefix = raw.replace(/\D/g, "").slice(0, digits);
  return prefix.length === digits ? prefix : null;
}
