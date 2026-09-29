export function isUsableGeoPoint(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat !== 0 || lng !== 0;
}

export function parseUsableGeoPoint(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null {
  const parsedLat = typeof lat === "number" ? lat : typeof lat === "string" ? Number(lat) : NaN;
  const parsedLng = typeof lng === "number" ? lng : typeof lng === "string" ? Number(lng) : NaN;
  if (!isUsableGeoPoint(parsedLat, parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}
