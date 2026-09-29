export const FULL_KI_DAILY_LIMIT = 10;

const KI_PENDING_WINDOW_MS = 48 * 60 * 60 * 1000;

export function isFullKiAnalysis(ki: { analysisTier?: string | null } | null | undefined): boolean {
  return ki?.analysisTier === "full";
}

export function isKiFullPending(ki: { fullStatus?: string | null } | null | undefined): boolean {
  return ki?.fullStatus === "queued" || ki?.fullStatus === "running";
}

const COPY_SCRAPING = "Objektdaten werden noch vollständig erfasst. Die KI-Analyse startet danach.";
const COPY_PENDING = "KI-Analyse wird noch verarbeitet…";
const COPY_MISSING =
  "Keine KI-Analyse vorhanden. Der Eintrag kann älter sein als die Analyse-Pipeline oder die Auswertung ist fehlgeschlagen.";

function toDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isFresh(date: Date | null, nowMs: number): boolean {
  return date != null && nowMs - date.getTime() < KI_PENDING_WINDOW_MS;
}

export function kiAnalysisEmptyCopy(
  listing: {
    createdAt?: Date | string | null;
    scrapeCompletedAt?: Date | string | null;
  },
  nowMs: number = Date.now(),
): string {
  const completed = toDate(listing.scrapeCompletedAt);
  if (!completed) {
    return isFresh(toDate(listing.createdAt), nowMs) ? COPY_SCRAPING : COPY_MISSING;
  }
  return isFresh(completed, nowMs) ? COPY_PENDING : COPY_MISSING;
}
