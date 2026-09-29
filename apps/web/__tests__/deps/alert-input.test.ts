import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALERT_MATCH_MAX_PAGES,
  ALERT_MATCH_PAGE_SIZE,
  MAX_ALERTS_PER_CRON_RUN,
  MAX_ALERTS_PER_USER,
  MAX_EMAILS_PER_CRON_RUN,
  MAX_LISTINGS_PER_ALERT_EMAIL,
  alertCriteriaFromForm,
  parseAlertCriteria,
  parseAlertName,
  parseAlertType,
  parseOptionalAlertActive,
  takeUnnotifiedAlertMatches,
} from "@/lib/alert-input";

describe("parseAlertType", () => {
  it("lässt nur zvg zu", () => {
    expect(parseAlertType("zvg")).toBe("zvg");
    expect(parseAlertType("real_estate")).toBeNull();
    expect(parseAlertType("")).toBeNull();
  });
});

describe("parseAlertName", () => {
  it("trimmt und begrenzt", () => {
    expect(parseAlertName("  NRW Wohnungen  ")).toBe("NRW Wohnungen");
    expect(parseAlertName("")).toBeNull();
    expect(parseAlertName("x".repeat(121))).toBeNull();
  });
});

describe("parseAlertCriteria", () => {
  it("akzeptiert nur flache Objekte", () => {
    expect(parseAlertCriteria({ bundesland: "bayern" })).toEqual({ bundesland: "bayern" });
    expect(parseAlertCriteria(["bayern"])).toBeNull();
    expect(parseAlertCriteria(null)).toBeNull();
    expect(parseAlertCriteria({})).toBeNull();
    expect(parseAlertCriteria({ extra: "drop" })).toBeNull();
  });

  it("normalisiert bekannte Felder und verwirft Unbekanntes", () => {
    expect(
      parseAlertCriteria({
        bundesland: "baden-wuerttemberg",
        kategorie: ["wohnung"],
        min_preis: 100000,
        max_preis: 400000,
        plz: "80331",
        umkreis_km: 25,
        extra: "drop",
        plz_lat: 48.1,
      }),
    ).toEqual({
      bundesland: "badenwuerttemberg",
      kategorie: ["wohnung"],
      min_preis: 100000,
      max_preis: 400000,
      plz: "80331",
      umkreis_km: 25,
    });
  });

  it("lehnt ungültige Grenzen und Kategorien ab", () => {
    expect(parseAlertCriteria({ bundesland: "narnia" })).toBeNull();
    expect(parseAlertCriteria({ kategorie: ["villa"] })).toBeNull();
    expect(parseAlertCriteria({ min_preis: 500, max_preis: 100 })).toBeNull();
    expect(parseAlertCriteria({ plz: "abc" })).toBeNull();
    expect(parseAlertCriteria({ umkreis_km: 10 })).toBeNull();
    expect(parseAlertCriteria({ min_preis: -1 })).toBeNull();
  });
});

describe("MAX_ALERTS_PER_USER", () => {
  it("begrenzt die Alert-Anzahl pro Konto", () => {
    expect(MAX_ALERTS_PER_USER).toBe(20);
    expect(MAX_ALERTS_PER_CRON_RUN).toBe(200);
    expect(MAX_EMAILS_PER_CRON_RUN).toBe(50);
    expect(MAX_LISTINGS_PER_ALERT_EMAIL).toBe(20);
    expect(ALERT_MATCH_PAGE_SIZE).toBe(200);
    expect(ALERT_MATCH_MAX_PAGES).toBe(10);
  });
});

describe("takeUnnotifiedAlertMatches", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("nimmt nur unbenachrichtigte Treffer bis zum Mail-Cap", () => {
    expect(takeUnnotifiedAlertMatches(rows, new Set(["b"]), 2)).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("liefert nichts bei vollem Cap oder leerer Seite", () => {
    expect(takeUnnotifiedAlertMatches(rows, new Set(), 0)).toEqual([]);
    expect(takeUnnotifiedAlertMatches([], new Set(), 20)).toEqual([]);
  });
});

describe("alertCriteriaFromForm", () => {
  const empty = {
    bundesland: "alle",
    kategorien: [] as string[],
    minPreis: "",
    maxPreis: "",
    minFlaeche: "",
    maxFlaeche: "",
    amtsgericht: "",
    plz: "",
    umkreisKm: "",
  };

  it("spiegelt parseAlertCriteria und lehnt Min>Max sowie leere Formulare ab", () => {
    expect(alertCriteriaFromForm({ ...empty, bundesland: "bayern" })).toEqual({
      ok: true,
      criteria: { bundesland: "bayern" },
    });
    expect(alertCriteriaFromForm({ ...empty, minPreis: "500", maxPreis: "100" }).ok).toBe(false);
    expect(alertCriteriaFromForm({ ...empty, minPreis: "abc" }).ok).toBe(false);
    expect(alertCriteriaFromForm({ ...empty, umkreisKm: "25" }).ok).toBe(false);
    expect(alertCriteriaFromForm(empty).ok).toBe(false);
    expect(alertCriteriaFromForm({ ...empty, plz: "80331", umkreisKm: "25" })).toEqual({
      ok: true,
      criteria: { plz: "80331", umkreis_km: 25 },
    });
  });
});

describe("parseOptionalAlertActive", () => {
  it("unterscheidet fehlend, gültig und ungültig", () => {
    expect(parseOptionalAlertActive(undefined)).toEqual({ ok: true });
    expect(parseOptionalAlertActive(true)).toEqual({ ok: true, value: true });
    expect(parseOptionalAlertActive("false")).toEqual({ ok: false });
  });
});

describe("Alert-UI", () => {
  it("validiert über alertCriteriaFromForm und erklärt exakte PLZ", () => {
    const form = readFileSync(
      path.join(__dirname, "../../app/account/alerts/alert-form.tsx"),
      "utf8",
    );
    expect(form).toContain("alertCriteriaFromForm");
    expect(form).toContain("Ohne Umkreis gilt die genaue PLZ");
    const card = readFileSync(
      path.join(__dirname, "../../app/account/alerts/alert-card.tsx"),
      "utf8",
    );
    expect(card).toContain("toast.error");
    expect(card).toContain("Umkreis ohne Koordinaten");
    expect(card).toContain("isUsableGeoPoint");
    expect(card).toContain("Zuletzt geprüft");
    expect(card).not.toContain("Zuletzt ausgelöst");
    const account = readFileSync(path.join(__dirname, "../../app/account/page.tsx"), "utf8");
    expect(account).toContain("shouldSkipAlertForMissingGeocode");
    expect(account).toContain("Umkreis ohne Koordinaten");
    expect(account).toContain("Zuletzt geprüft");
    expect(account).not.toContain("Letzter Treffer");
  });
});

describe("check-alerts Versand", () => {
  it("sendet SMTP vor dem Notification-Commit", () => {
    // Method chains may be wrapped across lines by the formatter.
    const src = readFileSync(
      path.join(__dirname, "../../app/api/cron/check-alerts/route.ts"),
      "utf8",
    ).replace(/\s*\n\s*\./g, ".");
    const lockAt = src.indexOf("pg_advisory_xact_lock");
    const sendAt = src.indexOf("await sendAlertEmail");
    const insertAt = src.indexOf("tx.insert(alertNotifications)");
    const triggerAt = src.lastIndexOf("lastTriggeredAt: now");
    expect(lockAt).toBeGreaterThan(0);
    expect(sendAt).toBeGreaterThan(lockAt);
    expect(insertAt).toBeGreaterThan(sendAt);
    expect(triggerAt).toBeGreaterThan(insertAt);
    expect(src).not.toContain("db.delete(alertNotifications)");
    expect(src).toContain("skippedMissingGeocode");
    expect(src).toContain("Umkreis ohne Koordinaten");
    expect(src).toContain("enrichAlertCriteria");
    expect(src).toContain("MAX_ALERT_GEOCODE_HEALS_PER_RUN");
    expect(src).toContain("pruneExpiredOperationalRows");
    expect(src).toContain("m.verkehrswert != null && Number.isFinite(Number(m.verkehrswert))");
    expect(src).not.toContain("Number(m.verkehrswert) || 0");
    expect(src).toContain("alertRadiusBoundingBox");
    expect(src).toContain("upcomingTerminSql()");
    expect(src).toContain("alertDueSql(now)");
    expect(src).toContain("::double precision BETWEEN");
    expect(src).not.toContain(
      "and(isNotNull(zvgListings.lat), isNotNull(zvgListings.lng)),\n                eq(zvgListings.plz, criteria.plz)",
    );
  });
});
