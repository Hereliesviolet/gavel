import { pgTable, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { userAlerts } from "./users";
import { zvgListings } from "./zvg";

/**
 * Protokolliert, welches Listing für welchen Alert bereits per E-Mail
 * gemeldet wurde. Verhindert Doppel-Versand (statt sich ausschließlich auf
 * einen Zeit-Cursor wie `userAlerts.lastTriggeredAt` zu verlassen, was bei
 * reaktivierten/bearbeiteten Alerts zu Lücken oder Duplikaten führen könnte)
 * und liefert nebenbei die "Anzahl bisheriger Treffer" für die Alert-Übersicht.
 */
export const alertNotifications = pgTable(
  "alert_notifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => userAlerts.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => zvgListings.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at").default(sql`NOW()`),
  },
  (t) => ({
    uniqueAlertListing: unique().on(t.alertId, t.listingId),
    idxAlertId: index("idx_alert_notifications_alert_id").on(t.alertId),
  }),
);
