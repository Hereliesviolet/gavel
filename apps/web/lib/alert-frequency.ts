import { sql } from "drizzle-orm";

export type AlertFrequency = "instant" | "daily" | "weekly";

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseAlertFrequency(raw: unknown): AlertFrequency | null {
  if (raw === "instant" || raw === "daily" || raw === "weekly") return raw;
  return null;
}

export function normalizeAlertFrequency(raw: string | null | undefined): AlertFrequency {
  return parseAlertFrequency(raw) ?? "daily";
}

/**
 * Ob ein Alert jetzt eine E-Mail senden darf.
 * instant: bei jedem Cron-Lauf mit neuen Treffern.
 * daily/weekly: Digest, höchstens einmal im Intervall (neue Treffer sammeln sich).
 */
export function alertIsDue(
  frequency: string | null | undefined,
  lastTriggeredAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const freq = normalizeAlertFrequency(frequency);
  if (freq === "instant") return true;
  if (!lastTriggeredAt) return true;
  const elapsed = now.getTime() - lastTriggeredAt.getTime();
  if (elapsed < 0) return true;
  return freq === "weekly" ? elapsed >= 7 * DAY_MS : elapsed >= DAY_MS;
}

export function alertDueSql(now = new Date()) {
  const nowIso = now.toISOString();
  const dailyCutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const weeklyCutoff = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  return sql`(
    COALESCE(frequency, 'daily') = 'instant'
    OR last_triggered_at IS NULL
    OR last_triggered_at > ${nowIso}::timestamptz
    OR (
      COALESCE(frequency, 'daily') = 'weekly'
      AND last_triggered_at <= ${weeklyCutoff}::timestamptz
    )
    OR (
      COALESCE(frequency, 'daily') NOT IN ('instant', 'weekly')
      AND last_triggered_at <= ${dailyCutoff}::timestamptz
    )
  )`;
}
