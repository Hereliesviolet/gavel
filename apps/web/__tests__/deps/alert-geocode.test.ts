import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { geocodePlz, isUsableGeoPoint, parseUsableGeoPoint } from "@/lib/geocode";
import {
  ALERT_GEOCODE_FAILED,
  ALERT_GEOCODE_UNAVAILABLE,
  alertExactPlz,
  alertRadiusBoundingBox,
  applyAlertGeocode,
  listingMatchesAlertRadius,
  reuseStoredAlertGeocode,
  shouldSkipAlertForMissingGeocode,
} from "@/lib/alert-geocode";

describe("applyAlertGeocode", () => {
  it("ändert nichts ohne PLZ und Umkreis", () => {
    const criteria = { bundesland: "bayern" };
    expect(applyAlertGeocode(criteria, null)).toEqual({ ok: true, criteria });
    expect(applyAlertGeocode({ plz: "80331" }, null)).toEqual({
      ok: true,
      criteria: { plz: "80331" },
    });
  });

  it("lehnt Umkreissuche ohne Koordinaten ab", () => {
    expect(applyAlertGeocode({ plz: "80331", umkreis_km: 10 }, null)).toEqual({
      ok: false,
      error: ALERT_GEOCODE_FAILED,
    });
  });

  it("schreibt Koordinaten bei erfolgreichem Geocode", () => {
    expect(applyAlertGeocode({ plz: "80331", umkreis_km: 10 }, { lat: 48.1, lng: 11.5 })).toEqual({
      ok: true,
      criteria: { plz: "80331", umkreis_km: 10, plz_lat: 48.1, plz_lng: 11.5 },
    });
    expect(applyAlertGeocode({ plz: "80331", umkreis_km: 10 }, { lat: 0, lng: 0 })).toEqual({
      ok: false,
      error: ALERT_GEOCODE_FAILED,
    });
  });

  it("überspringt gespeicherte Umkreis-Alerts ohne Koordinaten", () => {
    expect(shouldSkipAlertForMissingGeocode({ plz: "80331", umkreis_km: 10 })).toBe(true);
    expect(
      shouldSkipAlertForMissingGeocode({
        plz: "80331",
        umkreis_km: 10,
        plz_lat: 48.1,
        plz_lng: 11.5,
      }),
    ).toBe(false);
    expect(shouldSkipAlertForMissingGeocode({ plz: "80331" })).toBe(false);
    expect(
      shouldSkipAlertForMissingGeocode({
        plz: "80331",
        umkreis_km: 10,
        plz_lat: 0,
        plz_lng: 0,
      }),
    ).toBe(true);
  });

  it("wiederverwendet gespeicherte Koordinaten bei gleicher PLZ und gleichem Umkreis", () => {
    const stored = { plz: "80331", umkreis_km: 10, plz_lat: 48.1, plz_lng: 11.5 };
    expect(reuseStoredAlertGeocode({ plz: "80331", umkreis_km: 10 }, stored)).toEqual(stored);
    expect(reuseStoredAlertGeocode({ plz: "10115", umkreis_km: 10 }, stored)).toEqual({
      plz: "10115",
      umkreis_km: 10,
    });
    expect(reuseStoredAlertGeocode({ plz: "80331", umkreis_km: 25 }, stored)).toEqual({
      plz: "80331",
      umkreis_km: 25,
    });
    expect(
      reuseStoredAlertGeocode(
        { plz: "80331", umkreis_km: 10 },
        { plz: "80331", umkreis_km: 10, plz_lat: 0, plz_lng: 0 },
      ),
    ).toEqual({ plz: "80331", umkreis_km: 10 });
  });

  it("matcht eine PLZ ohne Umkreis exakt", () => {
    expect(alertExactPlz({ plz: "80331" })).toBe("80331");
    expect(alertExactPlz({ plz: "80331", umkreis_km: 10 })).toBeNull();
  });
});

describe("alertRadiusBoundingBox", () => {
  it("liefert eine Box, die den Umkreis enthält", () => {
    const box = alertRadiusBoundingBox({
      plz_lat: 48.137,
      plz_lng: 11.575,
      umkreis_km: 10,
    });
    expect(box).not.toBeNull();
    const north = 48.137 + 10 / 111;
    const east = 11.575 + 10 / (111 * Math.cos((48.137 * Math.PI) / 180));
    expect(north).toBeGreaterThan(box!.minLat);
    expect(north).toBeLessThan(box!.maxLat);
    expect(east).toBeGreaterThan(box!.minLng);
    expect(east).toBeLessThan(box!.maxLng);
    expect(alertRadiusBoundingBox({ plz_lat: 48.137, plz_lng: 11.575 })).toBeNull();
    expect(alertRadiusBoundingBox({ plz_lat: 0, plz_lng: 0, umkreis_km: 10 })).toBeNull();
  });
});

describe("listingMatchesAlertRadius", () => {
  const center = { plz: "80331", umkreis_km: 10, plz_lat: 48.137, plz_lng: 11.575 };

  it("lässt Listings ohne Umkreis-Kriterium durch", () => {
    expect(
      listingMatchesAlertRadius({ lat: null, lng: null, plz: "10115" }, { plz: "80331" }),
    ).toBe(true);
  });

  it("nutzt Haversine wenn Koordinaten da sind", () => {
    expect(listingMatchesAlertRadius({ lat: 48.137, lng: 11.575, plz: "80331" }, center)).toBe(
      true,
    );
    expect(listingMatchesAlertRadius({ lat: 52.52, lng: 13.405, plz: "10115" }, center)).toBe(
      false,
    );
  });

  it("fällt auf exakte PLZ zurück wenn das Listing keine Koordinaten hat", () => {
    expect(listingMatchesAlertRadius({ lat: null, lng: null, plz: "80331" }, center)).toBe(true);
    expect(listingMatchesAlertRadius({ lat: null, lng: null, plz: "10115" }, center)).toBe(false);
    expect(listingMatchesAlertRadius({ lat: null, lng: null, plz: null }, center)).toBe(false);
  });

  it("fällt auf PLZ zurück wenn Koordinaten ungültig sind", () => {
    expect(listingMatchesAlertRadius({ lat: "x", lng: "y", plz: "80331" }, center)).toBe(true);
    expect(listingMatchesAlertRadius({ lat: "x", lng: "y", plz: "10115" }, center)).toBe(false);
    expect(listingMatchesAlertRadius({ lat: 0, lng: 0, plz: "80331" }, center)).toBe(true);
    expect(listingMatchesAlertRadius({ lat: 0, lng: 0, plz: "10115" }, center)).toBe(false);
  });
});

describe("geocodePlz Antwort", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("behandelt Nicht-Arrays nicht als Treffer", () => {
    const src = readFileSync(path.join(__dirname, "../../lib/geocode.ts"), "utf8");
    expect(src).toContain("Array.isArray(data)");
    expect(src).toContain('reason: "unavailable"');
  });

  it("unterscheidet Ausfall und unbekannte PLZ", async () => {
    globalThis.fetch = async () => {
      throw new Error("timeout");
    };
    await expect(geocodePlz("80331")).resolves.toEqual({ ok: false, reason: "unavailable" });

    globalThis.fetch = async () => new Response("[]", { status: 200 });
    await expect(geocodePlz("80331")).resolves.toEqual({ ok: false, reason: "invalid" });

    globalThis.fetch = async () => new Response("err", { status: 503 });
    await expect(geocodePlz("80331")).resolves.toEqual({ ok: false, reason: "unavailable" });

    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ lat: "0", lon: "0" }]), { status: 200 });
    await expect(geocodePlz("80331")).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(isUsableGeoPoint(48.1, 11.5)).toBe(true);
    expect(isUsableGeoPoint(0, 0)).toBe(false);
    expect(isUsableGeoPoint(NaN, 11.5)).toBe(false);
    expect(parseUsableGeoPoint("48.1", "11.5")).toEqual({ lat: 48.1, lng: 11.5 });
    expect(parseUsableGeoPoint("0.0000000", "0.0000000")).toBeNull();
    expect(parseUsableGeoPoint(0, 11.5)).toEqual({ lat: 0, lng: 11.5 });

    expect(ALERT_GEOCODE_UNAVAILABLE).toContain("vorübergehend nicht verfügbar");
    const post = readFileSync(path.join(__dirname, "../../app/api/alerts/route.ts"), "utf8");
    const put = readFileSync(path.join(__dirname, "../../app/api/alerts/[id]/route.ts"), "utf8");
    expect(post).toContain("enriched.status");
    expect(put).toContain("enriched.status");
    const cron = readFileSync(
      path.join(__dirname, "../../app/api/cron/check-alerts/route.ts"),
      "utf8",
    );
    expect(cron).toContain("enrichAlertCriteria");
    expect(cron).toContain("MAX_ALERT_GEOCODE_HEALS_PER_RUN");
  });
});
