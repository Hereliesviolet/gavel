import { sql } from "drizzle-orm";

export const MANUAL_UPLOAD_HOST = "manuelle-eingabe.immopulse";

type ScrapeMetadata = {
  session_cookie_used?: unknown;
  fetch_source?: unknown;
};

export function isManualUploadSourceUrl(url: unknown): boolean {
  return typeof url === "string" && url.includes(`//${MANUAL_UPLOAD_HOST}/`);
}

function scrapeMetadata(rawData: unknown): ScrapeMetadata | null {
  if (!rawData || typeof rawData !== "object") return null;
  const meta = (rawData as { scrape_metadata?: unknown }).scrape_metadata;
  if (!meta || typeof meta !== "object") return null;
  return meta as ScrapeMetadata;
}

function flagIsTrue(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["true", "t", "1"].includes(value.trim().toLowerCase());
}

export const PUBLIC_LIVE_FETCH_SOURCES = ["http", "scrapling"] as const;

function isPublicLiveFetchSource(value: unknown): boolean {
  return (
    typeof value === "string" && (PUBLIC_LIVE_FETCH_SOURCES as readonly string[]).includes(value)
  );
}

/** Cookie-Session, manuelles HTML/PDF, Upload-Host oder fehlende Metadaten: nicht teilen. */
export function isPrivateCustomListing(rawData: unknown, sourceUrl?: unknown): boolean {
  if (isManualUploadSourceUrl(sourceUrl)) return true;
  const meta = scrapeMetadata(rawData);
  if (!meta) return true;
  if (flagIsTrue(meta.session_cookie_used)) return true;
  if (meta.fetch_source === "manual_html" || meta.fetch_source === "manual_pdf") return true;
  return !isPublicLiveFetchSource(meta.fetch_source);
}

/** Nur bekannte öffentliche Live-Scrapes zählen für Dedupe/Kandidaten-Beförderung. */
export function publicLiveScrapePredicate(table = `"real_estate_listings"`): string {
  return `
  COALESCE(${table}."raw_data" #>> '{scrape_metadata,fetch_source}', '')
    IN ('http', 'scrapling')
  AND lower(COALESCE(${table}."raw_data" #>> '{scrape_metadata,session_cookie_used}', ''))
    NOT IN ('true', 't', '1')
  AND COALESCE(${table}."source_url", '')
    NOT LIKE '%//${MANUAL_UPLOAD_HOST}/%'
`;
}

export const PUBLIC_LIVE_SCRAPE_PREDICATE = publicLiveScrapePredicate();

export const PUBLIC_LIVE_SCRAPE_SQL = sql.raw(PUBLIC_LIVE_SCRAPE_PREDICATE);

export function listingBeschreibungFromRaw(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== "object") return null;
  const value = (rawData as { beschreibung?: unknown }).beschreibung;
  return typeof value === "string" && value.trim() ? value : null;
}

export function canReadCustomListing(
  listing: { submittedByUserId?: string | null; rawData?: unknown; sourceUrl?: unknown },
  userId: string,
): boolean {
  if (listing.submittedByUserId === userId) return true;
  return !isPrivateCustomListing(listing.rawData, listing.sourceUrl);
}
