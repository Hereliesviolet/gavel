import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .default(sql`NOW()`)
      .notNull(),
  },
  (t) => ({
    actorCreatedIdx: index("audit_events_actor_created_idx").on(t.actorId, t.createdAt),
    actionCreatedIdx: index("audit_events_action_created_idx").on(t.action, t.createdAt),
  }),
);
