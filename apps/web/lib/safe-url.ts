const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function ipv4FromNumericHost(hostname: string): number[] | null {
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return [0, 0, 0, 0];
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }

  const dotted = hostname.split(".");
  if (dotted.length < 2 || dotted.length > 4) return null;
  if (!dotted.every((part) => /^\d+$/.test(part) || /^0x[0-9a-f]+$/i.test(part))) {
    return null;
  }

  const nums: number[] = [];
  for (const part of dotted) {
    const value = part.toLowerCase().startsWith("0x")
      ? parseInt(part, 16)
      : part.length > 1 && part.startsWith("0")
        ? parseInt(part, 8)
        : Number(part);
    if (!Number.isFinite(value) || value < 0) return [0, 0, 0, 0];
    nums.push(value);
  }

  if (nums.length === 2) {
    if (nums[0] > 255 || nums[1] > 0xffffff) return [0, 0, 0, 0];
    const n = (nums[0] << 24) | nums[1];
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (nums.length === 3) {
    if (nums[0] > 255 || nums[1] > 255 || nums[2] > 0xffff) return [0, 0, 0, 0];
    const n = (nums[0] << 24) | (nums[1] << 16) | nums[2];
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (nums.some((n) => n > 255)) return [0, 0, 0, 0];
  return nums;
}

function isPrivateIpv4Parts(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateOrReservedIp(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  if (
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost") ||
    h.endsWith(".localdomain") ||
    h.endsWith(".cluster.local") ||
    h.endsWith(".svc") ||
    h.endsWith(".nip.io") ||
    h.endsWith(".sslip.io") ||
    h.endsWith(".xip.io")
  ) {
    return true;
  }

  const numeric = ipv4FromNumericHost(h);
  if (numeric) return isPrivateIpv4Parts(numeric);

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return true;
    return isPrivateIpv4Parts(parts);
  }

  if (h.includes(":")) {
    const v6 = h.replace(/^\[|\]$/g, "");
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;

    // IPv4-mapped IPv6 - ein bekannter SSRF-Bypass, wenn nur die "reine"
    // IPv6-Form geprüft wird. `new URL()` normalisiert die eingegebene
    // Dotted-Decimal-Form ("::ffff:127.0.0.1") immer zur Hex-Form
    // ("::ffff:7f00:1") - beide werden hier abgedeckt.
    const mappedDotted = v6.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
    if (mappedDotted) {
      const parts = mappedDotted.slice(1).map(Number);
      if (parts.some((n) => n > 255)) return true;
      return isPrivateIpv4Parts(parts);
    }
    const mappedHex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const parts = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
      return isPrivateIpv4Parts(parts);
    }
  }

  return false;
}

/**
 * Custom-URL-Analyse (Phase 2): beliebige öffentliche https-Property-URL,
 * keine feste Portal-Allowlist mehr. Dies ist NUR die erste, syntaktische
 * Prüfschicht (kein DNS-Lookup im Next.js-Layer) - die maßgebliche,
 * DNS-auflösende SSRF-Prüfung läuft serverseitig im Scraper
 * (scrapers/src/utils/url_safety.py::assert_analyse_listing_url).
 */
export function validateAnalyseUrl(
  raw: unknown,
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "URL fehlt" };
  }
  if (raw.length > 2048) {
    return { ok: false, error: "URL zu lang" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Ungültige URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Nur https-URLs werden unterstützt" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URL mit Zugangsdaten ist nicht erlaubt" };
  }
  if (!parsed.hostname || isPrivateOrReservedIp(parsed.hostname)) {
    return { ok: false, error: "Dieser Ziel-Host ist nicht erlaubt" };
  }

  return { ok: true, url: stripSensitiveUrlQuery(parsed.toString()) };
}

export function isSafePublicHttpsUrl(raw: unknown): raw is string {
  return validateAnalyseUrl(raw).ok;
}

const LISTING_IMAGE_PATH = /^\/(?:zvg-images|api\/analyse)\/[A-Za-z0-9._~/-]+$/;
const REAL_ESTATE_IMAGE_PATH = /^\/zvg-images\/real-estate\//;

/**
 * Eigener öffentlicher Host, unter dem absolute Bild-URLs akzeptiert werden.
 * Kommt aus NEXT_PUBLIC_SITE_URL (Build-Zeit, damit Server und Client gleich
 * entscheiden); ohne Wert werden absolute URLs auf ihren App-Pfad reduziert.
 */
function listingImageRemoteHosts(): Set<string> {
  const hosts = new Set<string>();
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      hosts.add(new URL(raw).hostname.toLowerCase());
    } catch {
      // ungültiger Wert: kein zusätzlicher Host
    }
  }
  return hosts;
}

function listingImageAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 2048) return null;
  if (raw.startsWith("//") || raw.includes("..") || /[\s"'<>\\\0]/.test(raw)) return null;

  let path: string | null = null;
  if (raw.startsWith("/")) {
    if (raw.includes("://") || !LISTING_IMAGE_PATH.test(raw)) return null;
    path = raw;
  } else {
    try {
      const parsed = new URL(raw);
      const marker = "/zvg-images/";
      const idx = parsed.pathname.indexOf(marker);
      if (idx < 0) return null;
      const extracted = parsed.pathname.slice(idx);
      if (!LISTING_IMAGE_PATH.test(extracted)) return null;
      path = extracted;
    } catch {
      return null;
    }
  }

  if (!path || REAL_ESTATE_IMAGE_PATH.test(path)) return null;
  return path;
}

/** Öffentliche Cover-/Galerie-URL: nur App-Pfad, nie MinIO-/Fremd-Host. */
export function publicListingImageUrl(raw: unknown): string | null {
  return listingImageAppPath(raw);
}

function isDevMinioListingImageUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "http:" &&
      (host === "localhost" || host === "minio") &&
      (parsed.port === "9000" || parsed.port === "") &&
      listingImageAppPath(raw) !== null
    );
  } catch {
    return false;
  }
}

/** UI-src: App-Pfad, öffentlicher https-Host oder lokales MinIO für next/image. */
export function listingImageSrc(raw: unknown): string | null {
  if (typeof raw === "string" && isDevMinioListingImageUrl(raw)) return raw;
  const path = listingImageAppPath(raw);
  if (!path || typeof raw !== "string" || raw.startsWith("/")) return path;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol === "https:" &&
      listingImageRemoteHosts().has(parsed.hostname.toLowerCase())
    ) {
      return `${parsed.origin}${path}`;
    }
  } catch {
    return path;
  }
  return path;
}

/** Cover/Galerie: nur App-Pfade bzw. lokales MinIO, keine javascript:/Fremdhosts. */
export function isSafeListingImageUrl(raw: unknown): raw is string {
  return listingImageSrc(raw) !== null;
}

const COOKIE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Nutzer fügen oft den kompletten `Cookie:`-Header ein, nicht nur name=wert. */
export function normalizeCookieHeader(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.toLowerCase().startsWith("cookie:") ? trimmed.slice(7).trim() : trimmed;
}

export const MAX_COOKIE_PAIRS = 60;

function cookiePairName(part: string): string {
  const eq = part.indexOf("=");
  if (eq <= 0) return "";
  return part.slice(0, eq).trim();
}

export function isUsableCookieHeader(raw: string): boolean {
  if (raw.length === 0 || COOKIE_CONTROL_CHARS.test(raw)) return false;
  const pairs = raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => cookiePairName(part).length > 0);
  return pairs.length > 0 && pairs.length <= MAX_COOKIE_PAIRS;
}

const LISTING_TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "twclid",
  "yclid",
  "ttclid",
  "wbraid",
  "gbraid",
  "li_fat_id",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "_gac",
  "referrer",
  "searchid",
]);

function isListingTrackingQueryKey(key: string): boolean {
  const lower = key.trim().toLowerCase();
  if (!lower) return false;
  if (LISTING_TRACKING_QUERY_KEYS.has(lower)) return true;
  return (
    lower.startsWith("utm_") ||
    lower.startsWith("mtm_") ||
    lower.startsWith("pk_") ||
    lower.startsWith("hsa_")
  );
}

function listingPathDropsQuery(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path.includes("/expose/") || path.includes("/s-anzeige/");
}

export function stripListingIdentityQuery(url: string): string {
  try {
    const parsed = new URL(url);
    if (listingPathDropsQuery(parsed.pathname)) {
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isListingTrackingQueryKey(key)) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    if (parsed.hash) {
      parsed.hash = "";
      changed = true;
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "rid",
  "access_token",
  "refresh_token",
  "id_token",
  "session",
  "sessionid",
  "code",
  "auth",
  "key",
  "api_key",
  "apikey",
  "signature",
  "sid",
  "secret",
  "password",
  "passwd",
  "jwt",
  "bearer",
]);

const SENSITIVE_QUERY_SEGMENTS = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "jwt",
  "session",
  "sessionid",
  "auth",
  "key",
  "apikey",
  "signature",
  "sid",
  "bearer",
  "hmac",
  "otp",
]);

export function isSensitiveQueryKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (SENSITIVE_QUERY_KEYS.has(lower)) return true;
  if (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("passwd") ||
    lower.includes("jwt") ||
    lower.includes("session")
  ) {
    return true;
  }
  const segments = trimmed
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[-_.]/)
    .filter(Boolean);
  return segments.some((part) => SENSITIVE_QUERY_SEGMENTS.has(part));
}

export function telemetryRequestPath(path: string): string {
  const raw = path.trim();
  if (!raw) return "";
  try {
    return new URL(raw, "https://gavel.invalid").pathname;
  } catch {
    const queryAt = raw.indexOf("?");
    return queryAt === -1 ? raw : raw.slice(0, queryAt);
  }
}

export function stripSensitiveUrlQuery(url: string): string {
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

function likeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function listingSourceUrlPrefixes(url: string): string[] {
  const out = new Set<string>();
  try {
    const parsed = new URL(listingSourceUrlKey(url));
    parsed.search = "";
    parsed.hash = "";
    const apex = parsed.toString();
    out.add(apex);
    if (parsed.hostname && !parsed.hostname.startsWith("www.")) {
      parsed.hostname = `www.${parsed.hostname}`;
      out.add(parsed.toString());
    }
  } catch {
    /* ignore */
  }
  return [...out];
}

export function listingSourceUrlLikePatterns(url: string): string[] {
  return listingSourceUrlPrefixes(url).flatMap((prefix) => {
    const escaped = likeLiteral(prefix);
    return [`${escaped}?%`, `${escaped}#%`];
  });
}

export function listingSourceUrlKey(url: string): string {
  try {
    const parsed = new URL(stripListingIdentityQuery(stripSensitiveUrlQuery(url)));
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.toString();
  } catch {
    return stripListingIdentityQuery(stripSensitiveUrlQuery(url));
  }
}

export function indexListingSourceUrls(urls: Iterable<string | null | undefined>): Set<string> {
  const known = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    known.add(url);
    known.add(listingSourceUrlKey(url));
  }
  return known;
}

export function isKnownListingSourceUrl(known: Set<string>, url: string): boolean {
  return known.has(url) || known.has(listingSourceUrlKey(url));
}

/** Nur relative Same-Origin-Pfade (Open-Redirect-Schutz). */
export function safeInternalPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /[\0\r\n]/.test(value)) return fallback;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (
    decoded.startsWith("//") ||
    decoded.includes("://") ||
    decoded.includes("\\") ||
    decoded.includes("//")
  ) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "https://gavel.local");
    if (parsed.origin !== "https://gavel.local") return fallback;
    if (parsed.username || parsed.password) return fallback;
    if (!parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
