import { geocodePlz, haversineKm, isUsableGeoPoint } from "@/lib/geocode";

export const ALERT_GEOCODE_FAILED =
  "Die Postleitzahl konnte nicht geokodiert werden. Ohne Koordinaten ist die Umkreissuche nicht möglich.";
export const ALERT_GEOCODE_UNAVAILABLE =
  "Geocoding vorübergehend nicht verfügbar. Bitte später erneut versuchen.";

export type AlertCriteriaWithGeo = {
  plz?: string;
  umkreis_km?: number;
  plz_lat?: number;
  plz_lng?: number;
  [key: string]: unknown;
};

export function applyAlertGeocode<T extends AlertCriteriaWithGeo>(
  criteria: T,
  coords: { lat: number; lng: number } | null,
): { ok: true; criteria: T } | { ok: false; error: string } {
  if (!criteria.plz || criteria.umkreis_km == null) {
    return { ok: true, criteria };
  }
  if (!coords || !isUsableGeoPoint(coords.lat, coords.lng)) {
    return { ok: false, error: ALERT_GEOCODE_FAILED };
  }
  return {
    ok: true,
    criteria: { ...criteria, plz_lat: coords.lat, plz_lng: coords.lng },
  };
}

export function reuseStoredAlertGeocode<T extends AlertCriteriaWithGeo>(
  incoming: T,
  stored: AlertCriteriaWithGeo | null | undefined,
): T {
  if (!incoming.plz || incoming.umkreis_km == null) return incoming;
  if (
    stored?.plz === incoming.plz &&
    stored.umkreis_km === incoming.umkreis_km &&
    isUsableGeoPoint(stored.plz_lat, stored.plz_lng)
  ) {
    return { ...incoming, plz_lat: stored.plz_lat, plz_lng: stored.plz_lng };
  }
  return incoming;
}

export async function enrichAlertCriteria<T extends AlertCriteriaWithGeo>(
  criteria: T,
  stored?: AlertCriteriaWithGeo | null,
): Promise<{ ok: true; criteria: T } | { ok: false; error: string; status: 400 | 503 }> {
  const merged = reuseStoredAlertGeocode(criteria, stored);
  if (!merged.plz || merged.umkreis_km == null) {
    return { ok: true, criteria: merged };
  }
  if (isUsableGeoPoint(merged.plz_lat, merged.plz_lng)) {
    return { ok: true, criteria: merged };
  }
  const coords = await geocodePlz(merged.plz);
  if (!coords.ok) {
    return coords.reason === "unavailable"
      ? { ok: false, error: ALERT_GEOCODE_UNAVAILABLE, status: 503 }
      : { ok: false, error: ALERT_GEOCODE_FAILED, status: 400 };
  }
  return {
    ok: true,
    criteria: { ...merged, plz_lat: coords.lat, plz_lng: coords.lng },
  };
}

export function shouldSkipAlertForMissingGeocode(criteria: {
  plz?: string;
  umkreis_km?: number;
  plz_lat?: number;
  plz_lng?: number;
}): boolean {
  return Boolean(
    criteria.plz &&
    criteria.umkreis_km != null &&
    !isUsableGeoPoint(criteria.plz_lat, criteria.plz_lng),
  );
}

export function alertExactPlz(criteria: { plz?: string; umkreis_km?: number }): string | null {
  if (!criteria.plz || criteria.umkreis_km != null) return null;
  return criteria.plz;
}

const KM_PER_DEG_LAT = 111;
const ALERT_RADIUS_BOX_PAD = 1.1;

export function alertRadiusBoundingBox(criteria: {
  plz_lat?: number;
  plz_lng?: number;
  umkreis_km?: number;
}): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  const lat = Number(criteria.plz_lat);
  const lng = Number(criteria.plz_lng);
  const km = Number(criteria.umkreis_km);
  if (!isUsableGeoPoint(lat, lng) || !Number.isFinite(km) || km <= 0) return null;
  const paddedKm = km * ALERT_RADIUS_BOX_PAD;
  const latDelta = paddedKm / KM_PER_DEG_LAT;
  const lngKmPerDeg = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)) * KM_PER_DEG_LAT, 0.01);
  const lngDelta = paddedKm / lngKmPerDeg;
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export function listingMatchesAlertRadius(
  listing: {
    lat?: string | number | null;
    lng?: string | number | null;
    plz?: string | null;
  },
  criteria: {
    plz?: string;
    umkreis_km?: number;
    plz_lat?: number;
    plz_lng?: number;
  },
): boolean {
  const centerLat = Number(criteria.plz_lat);
  const centerLng = Number(criteria.plz_lng);
  if (!isUsableGeoPoint(centerLat, centerLng) || criteria.umkreis_km == null) {
    return true;
  }
  if (listing.lat != null && listing.lng != null) {
    const lat = Number(listing.lat);
    const lng = Number(listing.lng);
    if (isUsableGeoPoint(lat, lng)) {
      return haversineKm({ lat: centerLat, lng: centerLng }, { lat, lng }) <= criteria.umkreis_km;
    }
  }
  return Boolean(criteria.plz && listing.plz && listing.plz === criteria.plz);
}
