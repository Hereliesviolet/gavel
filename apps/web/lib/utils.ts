import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { addHours } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prüft, ob ein Route-Parameter ein gültiges UUID-Format hat, bevor er gegen
 * eine `uuid`-Spalte in Postgres verwendet wird. Ohne diesen Check wirft
 * Postgres bei ungültigen Strings (z.B. Slugs oder Tippfehlern in der URL)
 * einen ungefangenen `invalid input syntax for type uuid`-Fehler, der als
 * echter 500er statt eines saubere 404 durchschlägt.
 */
export function parseOptionalFinite(
  raw: string | null | undefined,
  parse: (value: string) => number = Number,
): number | null {
  if (raw == null || raw === "") return null;
  const n = parse(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseEuroSearchParam(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const normalized = raw.trim().replace(/\./g, "").replace(",", ".");
  const value = parseOptionalFinite(normalized, (v) => Number.parseInt(v, 10));
  return value != null && value >= 0 ? value : null;
}

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatPlzOrt(plz?: string | null, ort?: string | null): string {
  return [plz, ort]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

export const DISPLAY_TIME_ZONE = "Europe/Berlin";

function asDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(dateStr: string | Date | null | undefined): string {
  const date = asDate(dateStr);
  if (!date) return "—";
  return date.toLocaleDateString("de-DE", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function zonedCalendarDate(
  value: Date,
  timeZone = DISPLAY_TIME_ZONE,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: num("year"), month: num("month"), day: num("day") };
}

export function hasZonedClockTime(value: Date, timeZone = DISPLAY_TIME_ZONE): boolean {
  const clock = zonedClock(value, timeZone);
  return clock.hour !== 0 || clock.minute !== 0 || clock.second !== 0;
}

export function isUpcomingTermin(
  date: Date | string | null | undefined,
  now = new Date(),
): boolean {
  const target = asDate(date);
  if (!target) return false;
  const tage = calendarDaysUntil(target, now);
  if (tage == null || tage < 0) return false;
  if (tage === 0 && hasZonedClockTime(target) && target.getTime() < now.getTime()) {
    return false;
  }
  return true;
}

export function calendarDaysUntil(
  date: Date | string | null | undefined,
  now = new Date(),
): number | null {
  const target = asDate(date);
  if (!target) return null;
  const start = zonedCalendarDate(now);
  const end = zonedCalendarDate(target);
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function zonedClock(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
    second: num("second"),
  };
}

export function startOfZonedDay(value: Date = new Date(), timeZone = DISPLAY_TIME_ZONE): Date {
  const { year, month, day } = zonedCalendarDate(value, timeZone);
  const utcGuess = Date.UTC(year, month - 1, day);
  const shown = zonedClock(new Date(utcGuess), timeZone);
  const shownAsUtc = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    shown.second,
  );
  return new Date(utcGuess - (shownAsUtc - utcGuess));
}

export function addZonedCalendarDays(
  value: Date,
  days: number,
  timeZone = DISPLAY_TIME_ZONE,
): Date {
  const { year, month, day } = zonedCalendarDate(value, timeZone);
  const noonUtc = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return startOfZonedDay(noonUtc, timeZone);
}

export function exclusiveZonedCalendarHorizon(
  inclusiveDays: number,
  now = new Date(),
  timeZone = DISPLAY_TIME_ZONE,
): Date {
  return addZonedCalendarDays(startOfZonedDay(now, timeZone), inclusiveDays + 1, timeZone);
}

export function formatClockTime(dateStr: string | Date | null | undefined): string | null {
  const date = asDate(dateStr);
  if (!date || !hasZonedClockTime(date)) return null;
  return date.toLocaleTimeString("de-DE", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateTime(dateStr: string | Date | null | undefined): string {
  const date = asDate(dateStr);
  if (!date) return "—";
  const day = formatDate(date);
  const time = formatClockTime(date);
  return time ? `${day} ${time}` : day;
}

export function visiblePageNumbers(page: number, pages: number, maxVisible = 7): number[] {
  if (pages <= 0) return [];
  const current = Math.min(Math.max(1, page), pages);
  if (pages <= maxVisible) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(1, current - half);
  let end = start + maxVisible - 1;
  if (end > pages) {
    end = pages;
    start = pages - maxVisible + 1;
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function padZonedCalendarPart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatZonedCalendarDay(value: Date, timeZone = DISPLAY_TIME_ZONE): string {
  const { year, month, day } = zonedCalendarDate(value, timeZone);
  return `${year}${padZonedCalendarPart(month)}${padZonedCalendarPart(day)}`;
}

function formatZonedCalendarDayIso(value: Date, timeZone = DISPLAY_TIME_ZONE): string {
  const { year, month, day } = zonedCalendarDate(value, timeZone);
  return `${year}-${padZonedCalendarPart(month)}-${padZonedCalendarPart(day)}`;
}

type CalendarEventSchedule =
  | { kind: "timed"; start: Date; end: Date }
  | {
      kind: "allDay";
      startDay: string;
      endDayExclusive: string;
      startDayIso: string;
      endDayExclusiveIso: string;
    };

function calendarEventSchedule(terminDate: string, durationHours = 1): CalendarEventSchedule {
  const start = new Date(terminDate);
  if (!Number.isNaN(start.getTime()) && !hasZonedClockTime(start)) {
    const next = addZonedCalendarDays(start, 1);
    return {
      kind: "allDay",
      startDay: formatZonedCalendarDay(start),
      endDayExclusive: formatZonedCalendarDay(next),
      startDayIso: formatZonedCalendarDayIso(start),
      endDayExclusiveIso: formatZonedCalendarDayIso(next),
    };
  }
  return { kind: "timed", start, end: addHours(start, durationHours) };
}

function formatCalendarUtcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function buildGoogleCalendarUrl(params: {
  title: string;
  terminDate: string;
  location: string;
  direktlink?: string;
}): string {
  const schedule = calendarEventSchedule(params.terminDate);
  const dates =
    schedule.kind === "allDay"
      ? `${schedule.startDay}/${schedule.endDayExclusive}`
      : `${formatCalendarUtcStamp(schedule.start)}/${formatCalendarUtcStamp(schedule.end)}`;
  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(params.title)}` +
    `&dates=${dates}` +
    `&location=${encodeURIComponent(params.location)}` +
    (params.direktlink ? `&details=${encodeURIComponent("URL: " + params.direktlink)}` : "")
  );
}

const OUTLOOK_CALENDAR_HOSTS = new Set(["outlook.live.com", "outlook.office.com"]);

function outlookCalendarHost(): string {
  const host = process.env.OUTLOOK_CALENDAR_HOST?.trim().toLowerCase() ?? "";
  return OUTLOOK_CALENDAR_HOSTS.has(host) ? host : "outlook.live.com";
}

/**
 * Outlook Web Compose-Deeplink (aktuelles Format ohne /0/deeplink).
 * Default-Host: outlook.live.com (persönliches Outlook).
 * Optional: OUTLOOK_CALENDAR_HOST=outlook.office.com für Microsoft 365.
 * startdt/enddt als ISO-8601 UTC (`Date.toISOString()`), date-only Termine
 * als ganzer Berliner Kalendertag (`YYYY-MM-DD` / Folgetag exklusiv).
 * Hinweis: Ohne Login leitet Microsoft oft auf eine Download-Seite um —
 * für Desktop-Outlook ist .ics der zuverlässige Weg.
 */
export function buildOutlookCalendarUrl(params: {
  title: string;
  terminDate: string;
  location: string;
  direktlink?: string;
  body?: string;
  durationHours?: number;
}): string {
  const schedule = calendarEventSchedule(params.terminDate, params.durationHours ?? 1);
  const host = outlookCalendarHost();
  const body = params.body ?? (params.direktlink ? `URL: ${params.direktlink}` : undefined);
  const qs = new URLSearchParams({
    rru: "addevent",
    subject: params.title,
    startdt: schedule.kind === "allDay" ? schedule.startDayIso : schedule.start.toISOString(),
    enddt: schedule.kind === "allDay" ? schedule.endDayExclusiveIso : schedule.end.toISOString(),
    location: params.location,
  });
  if (body) qs.set("body", body);
  return `https://${host}/calendar/action/compose?${qs.toString()}`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** ICS-Inhalt (text/calendar) für Outlook Desktop / Apple / Thunderbird. */
export function buildVersteigerungIcs(params: {
  title: string;
  terminDate: string;
  location: string;
  description?: string;
  uid?: string;
  durationHours?: number;
}): string {
  const schedule = calendarEventSchedule(params.terminDate, params.durationHours ?? 1);
  const uid =
    params.uid ??
    (schedule.kind === "allDay"
      ? `zvg-${schedule.startDay}@gavel.example`
      : `zvg-${formatCalendarUtcStamp(schedule.start)}@gavel.example`);
  const dtStart =
    schedule.kind === "allDay"
      ? `DTSTART;VALUE=DATE:${schedule.startDay}`
      : `DTSTART:${formatCalendarUtcStamp(schedule.start)}`;
  const dtEnd =
    schedule.kind === "allDay"
      ? `DTEND;VALUE=DATE:${schedule.endDayExclusive}`
      : `DTEND:${formatCalendarUtcStamp(schedule.end)}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gavel//ZVG//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatCalendarUtcStamp(new Date())}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escapeIcsText(params.title)}`,
    `LOCATION:${escapeIcsText(params.location)}`,
  ];
  if (params.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(params.description)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export const GRUNDERWERBSTEUER: Record<string, number> = {
  hamburg: 0.055,
  niedersachsen: 0.05,
  "nordrhein-westfalen": 0.065,
  berlin: 0.06,
  bayern: 0.035,
  sachsen: 0.055,
  thueringen: 0.05,
  "sachsen-anhalt": 0.05,
  "mecklenburg-vorpommern": 0.06,
  "schleswig-holstein": 0.065,
  "rheinland-pfalz": 0.05,
  saarland: 0.065,
  bremen: 0.055,
  hessen: 0.06,
  badenwuerttemberg: 0.05,
  brandenburg: 0.065,
};

export const BUNDESLAENDER = [
  { slug: "hamburg", name: "Hamburg", kuerzel: "HH" },
  { slug: "berlin", name: "Berlin", kuerzel: "BE" },
  { slug: "niedersachsen", name: "Niedersachsen", kuerzel: "NI" },
  { slug: "nordrhein-westfalen", name: "Nordrhein-Westfalen", kuerzel: "NW" },
  { slug: "bayern", name: "Bayern", kuerzel: "BY" },
  { slug: "hessen", name: "Hessen", kuerzel: "HE" },
  { slug: "sachsen", name: "Sachsen", kuerzel: "SN" },
  { slug: "thueringen", name: "Thüringen", kuerzel: "TH" },
  { slug: "sachsen-anhalt", name: "Sachsen-Anhalt", kuerzel: "ST" },
  { slug: "mecklenburg-vorpommern", name: "Mecklenburg-Vorpommern", kuerzel: "MV" },
  { slug: "schleswig-holstein", name: "Schleswig-Holstein", kuerzel: "SH" },
  { slug: "rheinland-pfalz", name: "Rheinland-Pfalz", kuerzel: "RP" },
  { slug: "saarland", name: "Saarland", kuerzel: "SL" },
  { slug: "bremen", name: "Bremen", kuerzel: "HB" },
  { slug: "brandenburg", name: "Brandenburg", kuerzel: "BB" },
  { slug: "badenwuerttemberg", name: "Baden-Württemberg", kuerzel: "BW" },
];

export function hatDeutscheGrunderwerbsteuer(
  bundesland: string | null | undefined,
): bundesland is string {
  return Boolean(bundesland && bundesland in GRUNDERWERBSTEUER);
}

export function berechneErwerbskosten(
  verkehrswert: number,
  versteigerungswert: number,
  bundesland: string,
) {
  const rate = GRUNDERWERBSTEUER[bundesland] ?? 0.05;
  const grunderwerbsteuer = Math.round(versteigerungswert * rate);
  const grundbucheintrag = Math.round(versteigerungswert * 0.005);
  const zuschlagsgebuehr = Math.round(versteigerungswert * 0.005);
  const zinsBasis = Math.max(0, verkehrswert - versteigerungswert);
  const verzinsung = Math.round(zinsBasis * 0.04 * (32 / 365));

  return {
    grunderwerbsteuer,
    grunderwerbsteuerRate: rate,
    grundbucheintrag,
    zuschlagsgebuehr,
    verzinsung,
    verzinsterBetrag: zinsBasis,
    gesamt: grunderwerbsteuer + grundbucheintrag + zuschlagsgebuehr + verzinsung,
  };
}
