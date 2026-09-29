import { isUsableGeoPoint } from "@/lib/geo-point";
import { nominatimUserAgent } from "@/lib/site-url";

export { isUsableGeoPoint, parseUsableGeoPoint } from "@/lib/geo-point";

/**
 * Sehr einfache Geocoding-Hilfe für Alert-Kriterien (PLZ → lat/lng), damit
 * ein "Umkreis"-Radius um eine Postleitzahl berechnet werden kann.
 *
 * Nutzt Nominatim (OpenStreetMap) analog zu scrapers/src/utils/geocoding.py -
 * dieselbe Konvention wie beim bestehenden Python-Geocoding, kein zusätzlicher
 * API-Key nötig. Wird nur beim Anlegen/Bearbeiten eines Alerts aufgerufen
 * (seltene, nutzerausgelöste Aktion), daher unkritisch bzgl. Nominatim-
 * Rate-Limits (max. 1 req/s laut ToS).
 */
export type GeocodePlzResult =
  { ok: true; lat: number; lng: number } | { ok: false; reason: "invalid" | "unavailable" };

export async function geocodePlz(plz: string): Promise<GeocodePlzResult> {
  const cleaned = plz.trim();
  if (!/^\d{4,5}$/.test(cleaned)) return { ok: false, reason: "invalid" };

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("postalcode", cleaned);
    url.searchParams.set("country", "Germany");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const res = await fetch(url, {
      headers: { "User-Agent": nominatimUserAgent() },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };

    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: "invalid" };
    const first = data[0] as { lat?: unknown; lon?: unknown };
    const lat = typeof first.lat === "string" ? parseFloat(first.lat) : NaN;
    const lng = typeof first.lon === "string" ? parseFloat(first.lon) : NaN;
    if (!isUsableGeoPoint(lat, lng)) return { ok: false, reason: "invalid" };

    return { ok: true, lat, lng };
  } catch (err) {
    console.error("[geocodePlz] Fehler beim Geocoding", err);
    return { ok: false, reason: "unavailable" };
  }
}

/** Haversine-Distanz in km zwischen zwei Koordinatenpaaren. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}
