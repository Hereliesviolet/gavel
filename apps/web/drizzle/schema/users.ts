import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    emailVerified: timestamp("email_verified"),
    name: text("name"),
    passwordHash: text("password_hash"),
    role: text("role").default("user"), // 'user'|'admin'
    // Deprecated (Neon-only UI): früheres App-Farbthema — Feld bleibt in DB, ungenutzt.
    colorTheme: text("color_theme").notNull().default("violett"),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpConfirmedAt: timestamp("totp_confirmed_at"),
    totpBackupHashes: text("totp_backup_hashes").array(),
    pendingEmail: text("pending_email"),
    pendingEmailTokenHash: text("pending_email_token_hash"),
    pendingEmailExpiresAt: timestamp("pending_email_expires_at"),
    createdAt: timestamp("created_at").default(sql`NOW()`),
    updatedAt: timestamp("updated_at").default(sql`NOW()`),
  },
  (t) => ({
    emailLowerUnique: uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
  }),
);

export const sessions = pgTable("sessions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sessionToken: text("session_token").notNull().unique(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires").notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull().unique(),
  expires: timestamp("expires").notNull(),
});

export const userFavorites = pgTable(
  "user_favorites",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    listingType: text("listing_type").notNull(), // 'zvg'|'real_estate'
    listingId: uuid("listing_id").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`NOW()`),
  },
  (t) => ({
    uniqueUserListing: unique().on(t.userId, t.listingType, t.listingId),
  }),
);

export const userAlerts = pgTable(
  "user_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(), // 'zvg'
    name: text("name").notNull(),
    criteria: jsonb("criteria").notNull(),
    frequency: text("frequency").default("daily"), // 'instant'|'daily'|'weekly'
    isActive: boolean("is_active").default(true),
    lastTriggeredAt: timestamp("last_triggered_at"),
    createdAt: timestamp("created_at").default(sql`NOW()`),
  },
  (t) => ({
    // Trotz aktuell 0 Zeilen
    // zukunftssicher ergänzt - GET /api/alerts und check-alerts/route.ts
    // filtern/joinen über user_id. Live per CREATE INDEX CONCURRENTLY
    // angelegt (siehe drizzle/migrations/0003_user_alerts_user_id_idx.sql),
    // hier nur zur Dokumentation im Schema nachgezogen.
    idxUserId: index("idx_user_alerts_user_id").on(t.userId),
  }),
);
