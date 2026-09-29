import { sql } from "drizzle-orm";
import { zvgListings } from "@/drizzle/schema";

export { DEFAULT_TERMIN_HORIZON_DAYS } from "@/lib/termin-horizon";

/**
 * SQL-Pendant zu `isUpcomingTermin`: date-only (Berlin 00:00) bleibt am
 * Versteigerungstag sichtbar; eine echte Uhrzeit fällt nach Ablauf weg.
 */
export function upcomingTerminSql(column: typeof zvgListings.terminDate = zvgListings.terminDate) {
  return sql`(
    (
      ((${column} AT TIME ZONE 'Europe/Berlin')::time = TIME '00:00:00')
      AND ((${column} AT TIME ZONE 'Europe/Berlin')::date
        >= (NOW() AT TIME ZONE 'Europe/Berlin')::date)
    )
    OR
    (
      ((${column} AT TIME ZONE 'Europe/Berlin')::time <> TIME '00:00:00')
      AND ${column} > NOW()
    )
  )`;
}
