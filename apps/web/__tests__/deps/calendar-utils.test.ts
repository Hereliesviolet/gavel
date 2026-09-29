import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addZonedCalendarDays,
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildVersteigerungIcs,
  calendarDaysUntil,
  exclusiveZonedCalendarHorizon,
  formatClockTime,
  formatDate,
  formatDateTime,
  isUpcomingTermin,
  parseEuroSearchParam,
  parseOptionalFinite,
  startOfZonedDay,
  visiblePageNumbers,
} from "@/lib/utils";
import { computeTerminTage } from "@/lib/investor-picks";
import { daysUntil } from "@/components/ui/urgency-badge";

const TERMIN = "2026-08-10T06:30:00.000Z";
const DATE_ONLY_TERMIN = "2026-08-09T22:00:00.000Z";

describe("buildOutlookCalendarUrl", () => {
  const prevHost = process.env.OUTLOOK_CALENDAR_HOST;

  afterEach(() => {
    if (prevHost === undefined) delete process.env.OUTLOOK_CALENDAR_HOST;
    else process.env.OUTLOOK_CALENDAR_HOST = prevHost;
  });

  it("baut Outlook-Web-Compose mit Titel, Ort und Start/Ende", () => {
    delete process.env.OUTLOOK_CALENDAR_HOST;
    const url = buildOutlookCalendarUrl({
      title: "Wohnung – Versteigerung 5 K 12/24",
      terminDate: TERMIN,
      location: "Amtsgericht Bremerhaven",
      body: "Objekt: https://example.com/bremen/foo\nURL: https://justiz.de/x",
    });

    expect(url.startsWith("https://outlook.live.com/calendar/action/compose?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("subject")).toBe("Wohnung – Versteigerung 5 K 12/24");
    expect(parsed.searchParams.get("location")).toBe("Amtsgericht Bremerhaven");
    expect(parsed.searchParams.get("startdt")).toBe(TERMIN);
    expect(parsed.searchParams.get("enddt")).toBe("2026-08-10T07:30:00.000Z");
    expect(parsed.searchParams.get("startdt")).not.toBe("2026-08-10");
    expect(parsed.searchParams.get("body")).toContain("Objekt:");
    expect(parsed.searchParams.get("rru")).toBe("addevent");
    expect(parsed.pathname).toBe("/calendar/action/compose");
  });

  it("respektiert OUTLOOK_CALENDAR_HOST", () => {
    process.env.OUTLOOK_CALENDAR_HOST = "outlook.office.com";
    const url = buildOutlookCalendarUrl({
      title: "Test",
      terminDate: TERMIN,
      location: "Ort",
    });
    expect(url.startsWith("https://outlook.office.com/")).toBe(true);
  });

  it("fällt bei unbekanntem Outlook-Host auf outlook.live.com zurück", () => {
    process.env.OUTLOOK_CALENDAR_HOST = "evil.example";
    const url = buildOutlookCalendarUrl({
      title: "Test",
      terminDate: TERMIN,
      location: "Ort",
    });
    expect(url.startsWith("https://outlook.live.com/")).toBe(true);
    expect(url).not.toContain("evil.example");
  });

  it("legt date-only Termine als ganzen Berliner Kalendertag an", () => {
    delete process.env.OUTLOOK_CALENDAR_HOST;
    const url = buildOutlookCalendarUrl({
      title: "Date-only",
      terminDate: DATE_ONLY_TERMIN,
      location: "AG",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("startdt")).toBe("2026-08-10");
    expect(parsed.searchParams.get("enddt")).toBe("2026-08-11");
  });
});

describe("buildGoogleCalendarUrl", () => {
  it("schreibt Start/Ende als echte UTC-Stempel", () => {
    const url = buildGoogleCalendarUrl({
      title: "Wohnung",
      terminDate: TERMIN,
      location: "AG",
    });
    expect(url).toContain("dates=20260810T063000Z/20260810T073000Z");
  });

  it("legt date-only Termine als ganzen Berliner Kalendertag an", () => {
    const url = buildGoogleCalendarUrl({
      title: "Wohnung",
      terminDate: DATE_ONLY_TERMIN,
      location: "AG",
    });
    expect(url).toContain("dates=20260810/20260811");
    expect(url).not.toContain("T000000");
  });
});

describe("buildVersteigerungIcs", () => {
  it("enthält Title, Location, Start/Ende und stabile UID", () => {
    const ics = buildVersteigerungIcs({
      title: "Haus – Versteigerung 1 K 1/26",
      terminDate: TERMIN,
      location: "Saal 3, Amtsgericht",
      description: "Objekt: https://example.com/x",
      uid: "zvg-abc-123@gavel.example.com",
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Haus – Versteigerung 1 K 1/26");
    expect(ics).toContain("LOCATION:Saal 3\\, Amtsgericht");
    expect(ics).toContain("DTSTART:20260810T063000Z");
    expect(ics).toContain("DTEND:20260810T073000Z");
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toContain("UID:zvg-abc-123@gavel.example.com");
    expect(ics).toContain("DESCRIPTION:Objekt: https://example.com/x");
  });

  it("escaped Sonderzeichen in DESCRIPTION", () => {
    const ics = buildVersteigerungIcs({
      title: "T",
      terminDate: TERMIN,
      location: "L",
      description: "Zeile1\nURL: https://a.com?x=1,y=2;z=3",
      uid: "zvg-escape@gavel.example.com",
    });

    expect(ics).toContain("DESCRIPTION:Zeile1\\nURL: https://a.com?x=1\\,y=2\\;z=3");
    expect(ics).not.toMatch(/DESCRIPTION:.*[^\\],/);
  });

  it("escaped Steuerzeichen in der UID", () => {
    const ics = buildVersteigerungIcs({
      title: "T",
      terminDate: TERMIN,
      location: "L",
      uid: "zvg-x@gavel.example.com\r\nX-INJECTED:evil",
    });
    expect(ics).toContain("UID:zvg-x@gavel.example.com\\nX-INJECTED:evil");
    expect(ics).not.toMatch(/^X-INJECTED:/m);
  });

  it("legt date-only Termine als VALUE=DATE über den Berliner Kalendertag an", () => {
    const ics = buildVersteigerungIcs({
      title: "Date-only",
      terminDate: DATE_ONLY_TERMIN,
      location: "AG",
      uid: "zvg-date-only@gavel.example.com",
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260810");
    expect(ics).toContain("DTEND;VALUE=DATE:20260811");
    expect(ics).not.toContain("DTSTART:20260809T220000Z");
    expect(ics).not.toContain("DTEND:20260809T230000Z");
  });
});

describe("formatDate / formatDateTime", () => {
  it("zeigt Gerichtstermine in Europe/Berlin, nicht in UTC", () => {
    expect(formatDate("2026-08-10T06:30:00.000Z")).toBe("10.08.2026");
    expect(formatDateTime("2026-08-10T06:30:00.000Z")).toBe("10.08.2026 08:30");
    expect(formatClockTime("2026-08-10T06:30:00.000Z")).toBe("08:30");
    expect(formatDate("2026-08-09T22:30:00.000Z")).toBe("10.08.2026");
    expect(formatDateTime(startOfZonedDay(new Date("2026-08-10T12:00:00.000Z")))).toBe(
      "10.08.2026",
    );
    expect(formatClockTime(startOfZonedDay(new Date("2026-08-10T12:00:00.000Z")))).toBeNull();
    expect(formatDate(null)).toBe("—");
  });
});

describe("calendarDaysUntil / startOfZonedDay", () => {
  it("zählt Berliner Kalendertage, nicht gerundete 24h-Blöcke", () => {
    const termin = new Date("2026-08-10T05:00:00.000Z");
    const now = new Date("2026-08-09T20:00:00.000Z");
    expect(calendarDaysUntil(termin, now)).toBe(1);
    expect(daysUntil(termin, now)).toBe(1);
    expect(Math.round((termin.getTime() - now.getTime()) / 86_400_000)).toBe(0);
  });

  it("bleibt am selben Berliner Kalendertag bei 0", () => {
    const termin = new Date("2026-08-10T05:00:00.000Z");
    const now = new Date("2026-08-09T22:30:00.000Z");
    expect(calendarDaysUntil(termin, now)).toBe(0);
    expect(computeTerminTage(termin, now)).toBe(0);
  });

  it("liefert Mitternacht in Europe/Berlin als UTC-Instant", () => {
    expect(startOfZonedDay(new Date("2026-08-10T05:00:00.000Z")).toISOString()).toBe(
      "2026-08-09T22:00:00.000Z",
    );
    expect(startOfZonedDay(new Date("2026-01-15T10:00:00.000Z")).toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
    expect(addZonedCalendarDays(new Date("2026-08-10T05:00:00.000Z"), 1).toISOString()).toBe(
      "2026-08-10T22:00:00.000Z",
    );
    expect(
      exclusiveZonedCalendarHorizon(14, new Date("2026-08-10T05:00:00.000Z")).toISOString(),
    ).toBe("2026-08-24T22:00:00.000Z");
  });

  it("wertet vergangene Termine für die Investor-Tage nicht als offen", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    expect(computeTerminTage(new Date("2026-08-10T08:00:00.000Z"), now)).toBeNull();
    expect(calendarDaysUntil(new Date("2026-08-09T10:00:00.000Z"), now)).toBe(-1);
  });

  it("hält date-only Mitternacht-Termine am Berliner Kalendertag offen", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const midnight = startOfZonedDay(now);
    expect(calendarDaysUntil(midnight, now)).toBe(0);
    expect(isUpcomingTermin(midnight, now)).toBe(true);
    expect(computeTerminTage(midnight, now)).toBe(0);
    expect(isUpcomingTermin(new Date("2026-08-10T08:00:00.000Z"), now)).toBe(false);
    expect(isUpcomingTermin(new Date("2026-08-10T16:00:00.000Z"), now)).toBe(true);
    expect(daysUntil(midnight, now)).toBe(0);
    expect(daysUntil(new Date("2026-08-10T08:00:00.000Z"), now)).toBe(-1);
    expect(daysUntil(new Date("2026-08-10T16:00:00.000Z"), now)).toBe(0);
  });
});

describe("Berliner Kalendertage in den Oberflächen", () => {
  it("zieht Map-Pins, Suche, Termine und Alert-Mails auf dieselbe Zeitzone", () => {
    const bundesland = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/page.tsx"),
      "utf8",
    );
    expect(bundesland).toContain("async function getMapPins");
    expect(bundesland).toContain("MAP_PIN_LIMIT");
    expect(bundesland).toContain("MAP_PIN_LIMIT + 1");
    expect(bundesland).toContain("mapTruncated");
    expect(bundesland).not.toContain("mapPins.length >= MAP_PIN_LIMIT");
    expect(bundesland).toContain('status.includes("neu24")');
    expect(bundesland).toContain("24 * 60 * 60 * 1000");
    expect(bundesland).not.toContain("eq(zvgListings.istNeu, true)");
    expect(bundesland).toContain("startOfZonedDay");
    expect(bundesland).toContain("addZonedCalendarDays");
    expect(bundesland).toContain("exclusiveZonedCalendarHorizon");
    const terminSql = readFileSync(path.join(__dirname, "../../lib/termin-sql.ts"), "utf8");
    expect(terminSql).toContain(
      'export { DEFAULT_TERMIN_HORIZON_DAYS } from "@/lib/termin-horizon"',
    );
    const horizon = readFileSync(path.join(__dirname, "../../lib/termin-horizon.ts"), "utf8");
    expect(horizon).toContain("export const DEFAULT_TERMIN_HORIZON_DAYS = 180");
    expect(bundesland).toContain("upcomingTerminSql()");
    expect(bundesland).toContain('getStr("min_termin") ?? "0"');
    expect(bundesland).toContain("DEFAULT_TERMIN_HORIZON_DAYS");
    expect(bundesland).toContain("String(DEFAULT_TERMIN_HORIZON_DAYS)");
    expect(bundesland).toContain("Math.max(");
    expect(bundesland).toContain("minTermin === 0");
    expect(bundesland).not.toContain("if (!isNaN(minTermin))");
    expect(bundesland).not.toContain("gte(zvgListings.terminDate, today)");
    expect(bundesland).toContain("inArray(zvgListings.amtsgericht, amtsgerichte)");
    expect(bundesland).toContain("async function getAmtsgerichte");
    expect(bundesland).toContain("listingQueryParts(bundesland, {");
    expect(bundesland).toContain("amtsgericht: undefined");
    expect(bundesland).toContain("getAmtsgerichte(bundesland, sp)");
    expect(bundesland).not.toContain("amtsgerichte={[]}");
    const suche = readFileSync(path.join(__dirname, "../../app/suche/page.tsx"), "utf8");
    expect(suche).toContain("SEARCH_RESULT_LIMIT");
    expect(suche).toContain("listings.length");
    expect(suche).toContain("upcomingTerminSql()");
    expect(suche).toContain("listingTextSearchSql(query)");
    expect(suche).toContain("asc(zvgListings.terminDate), asc(zvgListings.id)");
    expect(suche).toContain(".offset((page - 1) * SEARCH_RESULT_LIMIT)");
    expect(suche).toContain("visiblePageNumbers(page, pages, 7)");
    expect(suche).toContain("function suchePageHref");
    const terminePage = readFileSync(path.join(__dirname, "../../app/termine/page.tsx"), "utf8");
    const termineApi = readFileSync(path.join(__dirname, "../../app/api/termine/route.ts"), "utf8");
    expect(terminePage).toContain("upcomingTerminSql()");
    expect(terminePage).toContain("formatClockTime");
    expect(terminePage).toContain("asc(zvgListings.terminDate), asc(zvgListings.id)");
    expect(terminePage).not.toContain("gt(zvgListings.terminDate, jetzt)");
    expect(termineApi).toContain("upcomingTerminSql()");
    expect(termineApi).toContain("asc(zvgListings.terminDate), asc(zvgListings.id)");
    expect(termineApi).toContain(".limit(500)");
    expect(termineApi).toContain("total: Number(total ?? 0)");
    expect(termineApi).not.toContain("gt(zvgListings.terminDate, jetzt)");
    const email = readFileSync(path.join(__dirname, "../../lib/email.ts"), "utf8");
    expect(email).toContain("formatDateBerlin");
    const sheet = readFileSync(
      path.join(__dirname, "../../components/zvg/alle-termine-sheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain("DISPLAY_TIME_ZONE");
    expect(sheet).toContain("Array.isArray((payload as { termine: unknown }).termine)");
    expect(sheet).toContain("total > termine.length");
    const ticker = readFileSync(
      path.join(__dirname, "../../components/layout/live-ticker.tsx"),
      "utf8",
    );
    expect(ticker).toContain("startOfZonedDay");
    expect(ticker).toContain("addZonedCalendarDays(startOfToday, -7)");
    expect(ticker).toContain("pickTopBundeslandByCount");
    expect(ticker).toContain("upcomingTerminSql()");
    expect(ticker).toContain("DEFAULT_TERMIN_HORIZON_DAYS");
    expect(ticker).toContain("opsRow");
    expect(ticker).not.toContain(".limit(1)");
    expect(ticker).not.toContain("7 * 24 * 60 * 60 * 1000");
    const listingCard = readFileSync(
      path.join(__dirname, "../../components/zvg/listing-card.tsx"),
      "utf8",
    );
    expect(listingCard).toContain("formatClockTime(listing.terminDate)");
    expect(listingCard).toContain("daysUntil(listing.terminDate)");
    const desk = readFileSync(
      path.join(__dirname, "../../app/investor/desk/desk-client.tsx"),
      "utf8",
    );
    expect(desk).toContain("calendarDaysUntil");
    expect(desk).toContain("isUpcomingTermin");
    expect(desk).not.toContain("86_400_000");
    const heute = readFileSync(path.join(__dirname, "../../app/investor/page.tsx"), "utf8");
    expect(heute).toContain("isUpcomingTermin(eintrag.terminDate)");
    expect(heute).not.toContain("getTime() < jetzt");
    const finder = readFileSync(path.join(__dirname, "../../lib/investor-finder.ts"), "utf8");
    const queries = readFileSync(path.join(__dirname, "../../lib/investor-queries.ts"), "utf8");
    expect(finder).toContain("exclusiveZonedCalendarHorizon");
    expect(finder).toContain("isUpcomingTermin");
    expect(finder).toContain("upcomingTerminSql()");
    expect(finder).toMatch(/const conditions = \[[\s\S]*?upcomingTerminSql\(\),\s*\]/);
    expect(finder).not.toContain("horizon.setDate");
    expect(finder).not.toContain("gte(zvgListings.terminDate, sql`NOW()`)");
    expect(queries).toContain("exclusiveZonedCalendarHorizon");
    expect(queries).toContain("upcomingTerminSql()");
    expect(queries).toMatch(
      /strategy === "fix_flip"[\s\S]*?upcomingTerminSql\(\)[\s\S]*?strategy === "buy_hold"[\s\S]*?upcomingTerminSql\(\)[\s\S]*?strategy === "unter_markt"[\s\S]*?upcomingTerminSql\(\)/,
    );
    expect(queries).toContain('isTerminWithinDays(terminDate, period === "week" ? 7 : 30, now)');
    expect(queries).not.toContain("terminDate < now");
    expect(queries).not.toContain("horizon.setDate");
    expect(queries).not.toContain("seit.setDate");
    expect(queries).not.toContain("gte(zvgListings.terminDate, jetzt)");
    const stats = readFileSync(path.join(__dirname, "../../lib/market-stats.ts"), "utf8");
    expect(stats).toContain("addZonedCalendarDays(startOfZonedDay(), -7)");
    expect(stats).not.toContain("siebenTageAgo.setDate");
    expect(stats).toContain("exclusiveZonedCalendarHorizon(7)");
    expect(stats).toContain("exclusiveZonedCalendarHorizon(14)");
    expect(stats).toContain("exclusiveZonedCalendarHorizon(30)");
    expect(stats).not.toContain("INTERVAL '7 days'");
    expect(stats).toContain("calendarDaysUntil(naechsterTermin.terminDate, jetzt)");
    expect(stats).toContain("asc(zvgListings.terminDate), asc(zvgListings.id)");
    expect(stats).toContain("upcomingTerminSql()");
    expect(stats).toContain("TO_CHAR(termin_date AT TIME ZONE 'Europe/Berlin'");
    expect(stats).toContain("exclusiveZonedCalendarHorizon(90)");
    expect(stats).not.toContain("dreiMonateVoraus.setMonth");
    expect(stats).not.toContain("TO_CHAR(termin_date, 'YYYY-MM')");
    expect(stats).not.toContain("1000 * 60 * 60 * 24");
    expect(stats).not.toContain("termin_date >= NOW()");
    const datenbasis = readFileSync(
      path.join(__dirname, "../../app/investor/datenbasis/page.tsx"),
      "utf8",
    );
    expect(datenbasis).toContain("heute");
    expect(datenbasis).toContain("stats.naechsterTerminTage");
    const home = readFileSync(path.join(__dirname, "../../app/page.tsx"), "utf8");
    expect(home).toContain('href: "/suche?typ=wohnung"');
    expect(home).not.toContain("active: true");
    expect(home).toContain("exclusiveZonedCalendarHorizon(7, now)");
    expect(home).toContain("asc(zvgListings.terminDate), asc(zvgListings.id)");
    expect(home).toContain("addZonedCalendarDays(startOfZonedDay(), -7).toISOString()");
    expect(home).toContain("upcomingTerminSql()");
    expect(home).toContain("DEFAULT_TERMIN_HORIZON_DAYS");
    expect(home).toContain("formatClockTime");
    expect(home).not.toContain("7 * 24 * 60 * 60 * 1000");
    expect(home).toContain("24 * 60 * 60 * 1000");
    expect(home).not.toContain("gte(zvgListings.terminDate, now)");
    const laender = readFileSync(path.join(__dirname, "../../app/laender/page.tsx"), "utf8");
    expect(laender).toContain("addZonedCalendarDays(startOfZonedDay(), -7).toISOString()");
    expect(laender).toContain("upcomingTerminSql()");
    expect(laender).toContain("DEFAULT_TERMIN_HORIZON_DAYS");
    expect(laender).not.toContain("7 * 24 * 60 * 60 * 1000");
    const archiv = readFileSync(path.join(__dirname, "../../app/archiv/page.tsx"), "utf8");
    expect(archiv).toContain("Archiv – Inaktive Verfahren");
    expect(archiv).toContain("listingTextSearchSql(suche)");
    expect(archiv).toContain("Ort, Adresse, PLZ, Amtsgericht, Aktenzeichen");
    expect(archiv).toContain("offline: !listing.terminDate || listing.terminDate > now");
    expect(archiv).not.toContain("Bereits versteigerte Objekte");
    const filterPanel = readFileSync(
      path.join(__dirname, "../../components/zvg/filter-panel.tsx"),
      "utf8",
    );
    expect(filterPanel).toContain("v >= PREIS_SLIDER_MAX");
    expect(filterPanel).toContain('v >= FLAECHE_SLIDER_MAX ? "beliebig"');
    expect(filterPanel).toContain("preis: [0, PREIS_SLIDER_MAX]");
    expect(filterPanel).toContain("flaeche: [0, FLAECHE_SLIDER_MAX]");
    expect(filterPanel).toContain("DEFAULT_TERMIN_HORIZON_DAYS");
    expect(filterPanel).not.toContain("max: 180");
    expect(filterPanel).not.toContain("termin: [0, 180]");
  });
});

describe("visiblePageNumbers", () => {
  it("schiebt das Fenster mit der aktuellen Seite", () => {
    expect(visiblePageNumbers(1, 3, 7)).toEqual([1, 2, 3]);
    expect(visiblePageNumbers(1, 12, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(visiblePageNumbers(8, 12, 7)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(visiblePageNumbers(12, 12, 7)).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("parseOptionalFinite", () => {
  it("verwirft leere und nicht-numerische Werte", () => {
    expect(parseOptionalFinite(null)).toBeNull();
    expect(parseOptionalFinite("")).toBeNull();
    expect(parseOptionalFinite("foo")).toBeNull();
    expect(parseOptionalFinite("abc", (value) => Number.parseInt(value, 10))).toBeNull();
  });

  it("parst gültige Zahlen", () => {
    expect(parseOptionalFinite("12")).toBe(12);
    expect(parseOptionalFinite("3.5", Number.parseFloat)).toBe(3.5);
    expect(parseOptionalFinite("20", (value) => Number.parseInt(value, 10))).toBe(20);
  });
});

describe("parseEuroSearchParam", () => {
  it("liest Deep-Link- und deutsche Tausenderwerte", () => {
    expect(parseEuroSearchParam("250000")).toBe(250000);
    expect(parseEuroSearchParam("250.000")).toBe(250000);
    expect(parseEuroSearchParam("abc")).toBeNull();
    expect(parseEuroSearchParam("")).toBeNull();
    expect(parseEuroSearchParam("-1")).toBeNull();
  });
});
