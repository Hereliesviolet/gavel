const MAX_COUNT = 10_000_000;
const MAX_SOURCE_KEYS = 40;
const MAX_REASONS = 50;
const MAX_LABEL = 80;

export type QualityReason = {
  field: string;
  reason: string;
  count: number;
};

export type QualitySummary = {
  total_active: number;
  total_needs_review: number;
  by_source: Record<string, number>;
  by_reason: QualityReason[];
};

export type DataQualityReportPayload = {
  summary: QualitySummary;
  previous: { total_needs_review: number } | null;
};

function finiteInt(raw: unknown, min = 0, max = MAX_COUNT): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return null;
  }
  if (raw < min || raw > max) return null;
  return raw;
}

function clipLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.trim().slice(0, MAX_LABEL);
  return label || null;
}

function parseBySource(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const label = clipLabel(key);
    const count = finiteInt(value);
    if (!label || count == null) return null;
    out[label] = count;
    if (Object.keys(out).length >= MAX_SOURCE_KEYS) break;
  }
  return out;
}

function parseByReason(raw: unknown): QualityReason[] | null {
  if (!Array.isArray(raw)) return null;
  const out: QualityReason[] = [];
  for (const item of raw.slice(0, MAX_REASONS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const field = clipLabel(row.field);
    const reason = clipLabel(row.reason);
    const count = finiteInt(row.count);
    if (!field || !reason || count == null) return null;
    out.push({ field, reason, count });
  }
  return out;
}

export function parseDataQualityReport(raw: unknown): DataQualityReportPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (!body.summary || typeof body.summary !== "object" || Array.isArray(body.summary)) {
    return null;
  }
  const summaryRaw = body.summary as Record<string, unknown>;
  const totalActive = finiteInt(summaryRaw.total_active);
  const totalNeedsReview = finiteInt(summaryRaw.total_needs_review);
  const bySource = parseBySource(summaryRaw.by_source ?? {});
  const byReason = parseByReason(summaryRaw.by_reason ?? []);
  if (totalActive == null || totalNeedsReview == null || !bySource || !byReason) {
    return null;
  }

  let previous: { total_needs_review: number } | null = null;
  if (body.previous != null) {
    if (typeof body.previous !== "object" || Array.isArray(body.previous)) return null;
    const prevCount = finiteInt((body.previous as Record<string, unknown>).total_needs_review);
    if (prevCount == null) return null;
    previous = { total_needs_review: prevCount };
  }

  return {
    summary: {
      total_active: totalActive,
      total_needs_review: totalNeedsReview,
      by_source: bySource,
      by_reason: byReason,
    },
    previous,
  };
}
