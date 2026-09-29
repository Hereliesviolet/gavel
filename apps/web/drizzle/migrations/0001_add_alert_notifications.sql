CREATE TABLE IF NOT EXISTS "alert_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_id" uuid NOT NULL REFERENCES "user_alerts"("id") ON DELETE CASCADE,
  "listing_id" uuid NOT NULL REFERENCES "zvg_listings"("id") ON DELETE CASCADE,
  "sent_at" timestamp DEFAULT NOW(),
  CONSTRAINT "alert_notifications_alert_id_listing_id_unique" UNIQUE("alert_id","listing_id")
);

CREATE INDEX IF NOT EXISTS "idx_alert_notifications_alert_id" ON "alert_notifications" ("alert_id");
