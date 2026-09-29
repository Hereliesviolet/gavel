import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Eigenständiges Login-/Geräte-Tracking für die "Aktive Sitzungen"-Ansicht.
 *
 * HINTERGRUND: Auth.js läuft hier mit der Credentials-Provider + JWT-Session-
 * Strategie (siehe lib/auth.ts). Der Credentials-Provider unterstützt laut
 * Auth.js-Dokumentation KEINE "database"-Session-Strategie - ein Umstieg auf
 * DB-Sessions (trotz vorhandenem @auth/drizzle-adapter) wäre daher nicht ohne
 * größere Umbauten (z.B. Zwei-Schritt-Login über einen Adapter-kompatiblen
 * Provider) möglich. Diese Tabelle bildet daher eine pragmatische, zum
 * bestehenden JWT-Setup kompatible Lösung: Bei jedem erfolgreichen Login wird
 * hier ein Eintrag angelegt, dessen ID als "sid"-Claim im JWT mitgeführt wird.
 * Beim Lesen der Session (lib/auth.ts, `session`-Callback) wird geprüft, ob
 * der Eintrag noch existiert und nicht widerrufen ("revoked") wurde - so kann
 * ein einzelnes Gerät serverseitig abgemeldet werden, ohne das komplette
 * JWT-Signing-Verfahren umzustellen.
 */
export const userLoginSessions = pgTable(
  "user_login_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at")
      .default(sql`NOW()`)
      .notNull(),
    lastSeenAt: timestamp("last_seen_at")
      .default(sql`NOW()`)
      .notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    userIdIdx: index("user_login_sessions_user_id_idx").on(t.userId),
  }),
);
