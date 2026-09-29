import { findBundesland } from "@/lib/bundesland";
import { parseListingKategorien } from "@/lib/kategorien";

export const ALERT_TYPE_ZVG = "zvg" as const;
export type AlertType = typeof ALERT_TYPE_ZVG;
export const MAX_ALERTS_PER_USER = 20;
export const MAX_ALERTS_PER_CRON_RUN = 200;
export const MAX_EMAILS_PER_CRON_RUN = 50;
export const MAX_LISTINGS_PER_ALERT_EMAIL = 20;
export const ALERT_MATCH_PAGE_SIZE = 200;
export const ALERT_MATCH_MAX_PAGES = 10;

export function takeUnnotifiedAlertMatches<T extends { id: string }>(
  candidates: T[],
  alreadyIds: ReadonlySet<string>,
  remainingSlots: number,
): T[] {
  if (remainingSlots <= 0) return [];
  const out: T[] = [];
  for (const candidate of candidates) {
    if (alreadyIds.has(candidate.id)) continue;
    out.push(candidate);
    if (out.length >= remainingSlots) break;
  }
  return out;
}

const MAX_PREIS = 1_000_000_000;
const MAX_FLAECHE = 1_000_000;
const MAX_UMKREIS_KM = 250;
const MAX_AMTSGERICHT = 120;

export function parseAlertType(raw: unknown): AlertType | null {
  return raw === ALERT_TYPE_ZVG ? ALERT_TYPE_ZVG : null;
}

export function parseAlertName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > 120) return null;
  return name;
}

function parseBoundNumber(raw: unknown, min: number, max: number, integer: boolean): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (integer && !Number.isInteger(raw)) return null;
  if (raw < min || raw > max) return null;
  return raw;
}

function parseFormBound(raw: string, integer: boolean): number | undefined | null {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
}

export type AlertFormField =
  "name" | "minPreis" | "maxPreis" | "minFlaeche" | "maxFlaeche" | "plz" | "umkreisKm";

export function alertCriteriaFromForm(input: {
  bundesland: string;
  kategorien: string[];
  minPreis: string;
  maxPreis: string;
  minFlaeche: string;
  maxFlaeche: string;
  amtsgericht: string;
  plz: string;
  umkreisKm: string;
}):
  | { ok: true; criteria: Record<string, unknown> }
  | { ok: false; error: string; field: AlertFormField } {
  const minPreis = parseFormBound(input.minPreis, true);
  const maxPreis = parseFormBound(input.maxPreis, true);
  const minFlaeche = parseFormBound(input.minFlaeche, false);
  const maxFlaeche = parseFormBound(input.maxFlaeche, false);
  const umkreisKm = parseFormBound(input.umkreisKm, true);
  if (minPreis === null) {
    return {
      ok: false,
      field: "minPreis",
      error: "Bitte einen gültigen Minimalpreis in ganzen Euro angeben.",
    };
  }
  if (maxPreis === null) {
    return {
      ok: false,
      field: "maxPreis",
      error: "Bitte einen gültigen Maximalpreis in ganzen Euro angeben.",
    };
  }
  if (minFlaeche === null) {
    return {
      ok: false,
      field: "minFlaeche",
      error: "Bitte eine gültige Mindestfläche in m² angeben.",
    };
  }
  if (maxFlaeche === null) {
    return {
      ok: false,
      field: "maxFlaeche",
      error: "Bitte eine gültige Maximalfläche in m² angeben.",
    };
  }
  if (umkreisKm === null) {
    return {
      ok: false,
      field: "umkreisKm",
      error: "Bitte einen Umkreis zwischen 1 und 250 km wählen.",
    };
  }
  if (minPreis != null && maxPreis != null && minPreis > maxPreis) {
    return {
      ok: false,
      field: "maxPreis",
      error: "Der Maximalpreis muss über dem Minimalpreis liegen.",
    };
  }
  if (minFlaeche != null && maxFlaeche != null && minFlaeche > maxFlaeche) {
    return {
      ok: false,
      field: "maxFlaeche",
      error: "Die maximale Fläche muss über der minimalen Fläche liegen.",
    };
  }
  if (umkreisKm != null && !input.plz.trim()) {
    return { ok: false, field: "plz", error: "Umkreis braucht eine Postleitzahl." };
  }

  const raw: Record<string, unknown> = {};
  if (input.bundesland && input.bundesland !== "alle") raw.bundesland = input.bundesland;
  if (input.kategorien.length > 0) raw.kategorie = input.kategorien;
  if (minPreis != null) raw.min_preis = minPreis;
  if (maxPreis != null) raw.max_preis = maxPreis;
  if (minFlaeche != null) raw.min_flaeche = minFlaeche;
  if (maxFlaeche != null) raw.max_flaeche = maxFlaeche;
  if (input.amtsgericht.trim()) raw.amtsgericht = input.amtsgericht.trim();
  if (input.plz.trim()) raw.plz = input.plz.trim();
  if (umkreisKm != null) raw.umkreis_km = umkreisKm;

  const parsed = parseAlertCriteria(raw);
  if (!parsed) {
    return {
      ok: false,
      field: "name",
      error:
        "Bitte mindestens ein Suchkriterium setzen (Bundesland, Kategorie, Preis, Fläche, Amtsgericht oder PLZ).",
    };
  }
  return { ok: true, criteria: parsed };
}

export function parseAlertCriteria(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (src.bundesland != null && src.bundesland !== "" && src.bundesland !== "alle") {
    if (typeof src.bundesland !== "string") return null;
    const found = findBundesland(src.bundesland);
    if (!found) return null;
    out.bundesland = found.slug;
  }

  if (src.kategorie != null) {
    const list = Array.isArray(src.kategorie) ? src.kategorie : [src.kategorie];
    if (!list.every((item) => typeof item === "string")) return null;
    const kats = parseListingKategorien(list);
    if (kats.length !== list.length) return null;
    if (kats.length) out.kategorie = kats;
  }

  if (src.min_preis != null) {
    const value = parseBoundNumber(src.min_preis, 0, MAX_PREIS, true);
    if (value == null) return null;
    out.min_preis = value;
  }
  if (src.max_preis != null) {
    const value = parseBoundNumber(src.max_preis, 0, MAX_PREIS, true);
    if (value == null) return null;
    out.max_preis = value;
  }
  if (
    typeof out.min_preis === "number" &&
    typeof out.max_preis === "number" &&
    out.min_preis > out.max_preis
  ) {
    return null;
  }

  if (src.min_flaeche != null) {
    const value = parseBoundNumber(src.min_flaeche, 0, MAX_FLAECHE, false);
    if (value == null) return null;
    out.min_flaeche = value;
  }
  if (src.max_flaeche != null) {
    const value = parseBoundNumber(src.max_flaeche, 0, MAX_FLAECHE, false);
    if (value == null) return null;
    out.max_flaeche = value;
  }
  if (
    typeof out.min_flaeche === "number" &&
    typeof out.max_flaeche === "number" &&
    out.min_flaeche > out.max_flaeche
  ) {
    return null;
  }

  if (src.amtsgericht != null && src.amtsgericht !== "") {
    if (typeof src.amtsgericht !== "string") return null;
    const amtsgericht = src.amtsgericht.trim();
    if (!amtsgericht || amtsgericht.length > MAX_AMTSGERICHT) return null;
    out.amtsgericht = amtsgericht;
  }

  if (src.plz != null && src.plz !== "") {
    if (typeof src.plz !== "string" || !/^\d{4,5}$/.test(src.plz.trim())) return null;
    out.plz = src.plz.trim();
  }

  if (src.umkreis_km != null && src.umkreis_km !== "") {
    const value = parseBoundNumber(src.umkreis_km, 1, MAX_UMKREIS_KM, true);
    if (value == null) return null;
    if (!out.plz) return null;
    out.umkreis_km = value;
  }

  if (Object.keys(out).length === 0) return null;
  return out;
}

export function parseOptionalAlertActive(
  raw: unknown,
): { ok: true; value?: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true };
  if (typeof raw === "boolean") return { ok: true, value: raw };
  return { ok: false };
}
