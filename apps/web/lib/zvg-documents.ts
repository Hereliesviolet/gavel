import { findBundesland } from "@/lib/bundesland";
import { stripSensitiveUrlQuery } from "@/lib/safe-url";

export type ZvgDocumentKind = "gutachten" | "expose";

export const MAX_ZVG_SLUG = 200;

export function isUsableZvgSlug(slug: string | null | undefined): boolean {
  const value = slug?.trim() ?? "";
  return value.length > 0 && value.length <= MAX_ZVG_SLUG && /^[a-z0-9][a-z0-9-]*$/i.test(value);
}

export function isUsableZvgBundesland(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return (
    trimmed.length > 0 &&
    trimmed.length <= 80 &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    !trimmed.includes("\0") &&
    !trimmed.includes(".") &&
    !trimmed.includes(":") &&
    !trimmed.includes("@")
  );
}

/** Same-Origin-Detailpfad; leer/fremd verhindert `//host`-Open-Redirects. */
export function zvgListingPath(
  bundesland: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  const land = findBundesland(bundesland);
  if (!land || !isUsableZvgSlug(slug)) return null;
  return `/${land.slug}/${slug!.trim()}`;
}

export function zvgBundeslandFromRequest(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return isUsableZvgBundesland(trimmed) ? trimmed : undefined;
}

export function zvgPdfDownloadName(kind: ZvgDocumentKind, slug: string): string {
  const safe = slug.replace(/[^a-z0-9-]/gi, "").slice(0, MAX_ZVG_SLUG);
  return `${kind}-${safe || "objekt"}.pdf`;
}

const ZVG_EXTERNAL_DOC_HOSTS = new Set([
  "zvg-portal.de",
  "www.zvg-portal.de",
  "zvg.com",
  "www.zvg.com",
  "hanmark.de",
  "www.hanmark.de",
]);

export function isAllowedExternalZvgDocumentUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ZVG_EXTERNAL_DOC_HOSTS.has(host);
}

export function isPublicZvgSourceUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && isAllowedExternalZvgDocumentUrl(url);
  } catch {
    return false;
  }
}

export function isDirectlinkUsable(
  url: string | null | undefined,
  source?: string | null,
): boolean {
  if (!isPublicZvgSourceUrl(url) || source === "justizportal") return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      (host === "zvg-portal.de" || host === "www.zvg-portal.de") &&
      parsed.searchParams.get("button") === "showZvg"
    ) {
      return Boolean(parsed.searchParams.get("zvg_id") && parsed.searchParams.get("land_abk"));
    }
    return true;
  } catch {
    return false;
  }
}

const DOC_FILE: Record<ZvgDocumentKind, string> = {
  gutachten: "gutachten.pdf",
  expose: "expose.pdf",
};

export function zvgDocumentApiPath(
  slug: string,
  kind: ZvgDocumentKind,
  bundesland?: string | null,
): string {
  const path = `/api/zvg/${encodeURIComponent(slug)}/${kind}`;
  const scoped = zvgBundeslandFromRequest(bundesland);
  if (!scoped) return path;
  return `${path}?bundesland=${encodeURIComponent(scoped)}`;
}

function pathnameOf(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    if (trimmed.startsWith("/")) {
      return new URL(trimmed, "https://gavel.local").pathname;
    }
    return new URL(trimmed).pathname;
  } catch {
    return trimmed.split("?")[0] ?? "";
  }
}

export function isGavelStorageUrl(url: string): boolean {
  const path = pathnameOf(url);
  return path.includes("/zvg-images/") || path.startsWith("zvg-images/");
}

export function publicZvgDocumentHref(
  url: string | null | undefined,
  slug: string,
  kind: ZvgDocumentKind,
  bundesland?: string | null,
): string | null {
  if (!url) return null;
  if (isGavelStorageUrl(url)) {
    if (!isUsableZvgSlug(slug)) return null;
    return zvgDocumentApiPath(slug, kind, bundesland);
  }
  return isPublicZvgSourceUrl(url) ? stripSensitiveUrlQuery(url) : null;
}

export function candidateZvgDocumentKeys(
  listing: { id: string; bundesland: string; slug: string },
  kind: ZvgDocumentKind,
): string[] {
  const filename = DOC_FILE[kind];
  return [`${listing.id}/${filename}`, `${listing.bundesland}/${listing.slug}/${filename}`];
}

function isOwnedZvgDocumentKey(
  key: string,
  listing: { id: string; bundesland: string; slug: string },
  kind: ZvgDocumentKind,
): boolean {
  const filename = DOC_FILE[kind];
  const parts = key.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === ".")) return false;
  if (parts.length === 2 && parts[0] === listing.id && parts[1] === filename) {
    return true;
  }
  return (
    parts.length === 3 &&
    parts[0] === listing.bundesland &&
    parts[1] === listing.slug &&
    isUsableZvgSlug(parts[1]) &&
    parts[2] === filename
  );
}

export function extractStoredZvgDocumentKey(
  url: string,
  listing: { id: string; bundesland: string; slug: string },
  kind: ZvgDocumentKind,
): string | null {
  const path = pathnameOf(url);
  const marker = "/zvg-images/";
  let key: string;
  const idx = path.indexOf(marker);
  if (idx >= 0) {
    key = path.slice(idx + marker.length);
  } else if (path.startsWith("zvg-images/")) {
    key = path.slice("zvg-images/".length);
  } else {
    return null;
  }
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  key = key.replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!key || key.includes("..") || key.includes("\\") || key.includes("\0")) {
    return null;
  }
  return isOwnedZvgDocumentKey(key, listing, kind) ? key : null;
}
