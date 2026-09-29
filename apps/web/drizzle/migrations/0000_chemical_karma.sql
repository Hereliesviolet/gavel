CREATE TABLE "zvg_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid,
	"storage_path" text NOT NULL,
	"public_url" text,
	"position" smallint,
	"is_cover" boolean DEFAULT false,
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE "zvg_ki_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid,
	"grundbuch_blatt" text,
	"grundbuch_flurstueck" text,
	"grundbuch_gemarkung" text,
	"flurstuecke" jsonb,
	"maengel" jsonb,
	"belastungen" jsonb,
	"modernisierungen" jsonb,
	"gebaeudenutzungen" jsonb,
	"orte_in_der_naehe" jsonb,
	"bodenrichtwert_eur_m2" numeric(12, 2),
	"bodenrichtwert_stichtag" date,
	"bodenrichtwert_berechnung" text,
	"energieausweis_vorhanden" boolean,
	"effizienzklasse" text,
	"ausweisjahr" smallint,
	"energietraeger" text,
	"endenergieverbrauch_kwh" numeric(8, 2),
	"innenbesichtigung" boolean,
	"restnutzungsdauer_j" smallint,
	"heizung" text,
	"wohnraeume" text,
	"zustand_aussen" text,
	"zustand_innen" text,
	"maengel_kurz" text,
	"baubeschreibung" text,
	"instandhaltung" text,
	"baulasten" text,
	"lage_einwohner" integer,
	"lage_region" text,
	"lage_verkehr" text,
	"lage_charakter" text,
	"lage_umgebung" text,
	"moegliche_kaltmiete" numeric(10, 2),
	"hausgeld" numeric(10, 2),
	"jahresrohertrag" numeric(12, 2),
	"liegenschaftszinssatz" numeric(5, 3),
	"ertragswert" integer,
	"investment_score" text,
	"investment_score_begruendung" text,
	"risiken_investor" jsonb DEFAULT '[]'::jsonb,
	"fix_flip_massnahmen" jsonb DEFAULT '[]'::jsonb,
	"fix_flip_werteinschaetzung" text,
	"fix_flip_gesamtkosten_min_eur" integer,
	"fix_flip_gesamtkosten_max_eur" integer,
	"arv_min_eur" integer,
	"arv_max_eur" integer,
	"arv_begruendung" text,
	"arv_konfidenz" text,
	"holding_monate" smallint DEFAULT 9,
	"flip_gesamtinvestition_min_eur" integer,
	"flip_gesamtinvestition_max_eur" integer,
	"flip_gewinn_min_eur" integer,
	"flip_gewinn_max_eur" integer,
	"flip_roi_pct_min" numeric(6, 2),
	"flip_roi_pct_max" numeric(6, 2),
	"flip_opportunity_score" text,
	"flip_opportunity_begruendung" text,
	"flip_szenario" jsonb,
	"model_used" text,
	"tokens_used" integer,
	"analyzed_at" timestamp DEFAULT NOW(),
	CONSTRAINT "zvg_ki_analyses_listing_id_unique" UNIQUE("listing_id")
);
--> statement-breakpoint
CREATE TABLE "zvg_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aktenzeichen" text NOT NULL,
	"bundesland" text NOT NULL,
	"bundesland_name" text NOT NULL,
	"slug" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"direktlink" text,
	"typ" text,
	"kategorie" text,
	"adresse" text,
	"strasse" text,
	"hausnummer" text,
	"plz" text,
	"ort" text,
	"stadtteil" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"verkehrswert" numeric(14, 0),
	"limit_75_pct" numeric(14, 0),
	"limit_50_pct" numeric(14, 0),
	"wohnflaeche_m2" numeric(10, 2),
	"grundstuecksflaeche_m2" numeric(10, 2),
	"nutzflaeche_m2" numeric(10, 2),
	"gesamtflaeche_m2" numeric(10, 2),
	"baujahr" smallint,
	"zimmer" numeric(4, 1),
	"etage" smallint,
	"amtsgericht" text,
	"versteigerungsort" text,
	"termin_date" timestamp with time zone,
	"termin_saal" text,
	"ist_neu" boolean DEFAULT false,
	"ist_aktiv" boolean DEFAULT true,
	"denkmalschutz" boolean,
	"vermietet" boolean,
	"beschreibung" text,
	"miteigentumsanteil" text,
	"sondereigentum" text,
	"gutachten_url" text,
	"expose_url" text,
	"raw_data" jsonb,
	"scraped_at" timestamp DEFAULT NOW(),
	"created_at" timestamp DEFAULT NOW(),
	"updated_at" timestamp DEFAULT NOW(),
	"last_seen_at" timestamp with time zone DEFAULT NOW(),
	"data_quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"data_quality_checked_at" timestamp with time zone,
	"scrape_completed_at" timestamp with time zone,
	CONSTRAINT "zvg_listings_aktenzeichen_source_bundesland_unique" UNIQUE("aktenzeichen","source","bundesland")
);
--> statement-breakpoint
CREATE TABLE "custom_url_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"url" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"listing_id" uuid,
	"requested_at" timestamp with time zone DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE "real_estate_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"public_url" text,
	"position" smallint,
	"created_at" timestamp DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE "real_estate_ki_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"preis_bewertung" text,
	"preis_abweichung_pct" numeric(6, 2),
	"staerken" jsonb DEFAULT '[]'::jsonb,
	"schwaechen" jsonb DEFAULT '[]'::jsonb,
	"lage_bewertung" text,
	"rendite_geschaetzt_pct" numeric(6, 2),
	"zusammenfassung" text,
	"investment_score" text,
	"investment_score_begruendung" text,
	"risiken_investor" jsonb DEFAULT '[]'::jsonb,
	"cashflow_einschaetzung" text,
	"fix_flip_massnahmen" jsonb DEFAULT '[]'::jsonb,
	"fix_flip_werteinschaetzung" text,
	"fix_flip_gesamtkosten_min_eur" integer,
	"fix_flip_gesamtkosten_max_eur" integer,
	"arv_min_eur" integer,
	"arv_max_eur" integer,
	"arv_begruendung" text,
	"arv_konfidenz" text,
	"holding_monate" smallint DEFAULT 9,
	"flip_gesamtinvestition_min_eur" integer,
	"flip_gesamtinvestition_max_eur" integer,
	"flip_gewinn_min_eur" integer,
	"flip_gewinn_max_eur" integer,
	"flip_roi_pct_min" numeric(6, 2),
	"flip_roi_pct_max" numeric(6, 2),
	"flip_opportunity_score" text,
	"flip_opportunity_begruendung" text,
	"flip_szenario" jsonb,
	"model_used" text,
	"tokens_used" integer DEFAULT 0,
	"analyzed_at" timestamp with time zone DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE "real_estate_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"typ" text,
	"angebotstyp" text,
	"titel" text,
	"adresse" text,
	"plz" text,
	"ort" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"preis" integer,
	"preis_pro_m2" numeric(10, 2),
	"wohnflaeche_m2" numeric(10, 2),
	"zimmer" numeric(4, 1),
	"baujahr" smallint,
	"effizienzklasse" text,
	"cover_image_url" text,
	"ist_aktiv" boolean DEFAULT true,
	"raw_data" jsonb,
	"scraped_at" timestamp DEFAULT NOW(),
	"first_seen_at" timestamp DEFAULT NOW(),
	"last_seen_at" timestamp DEFAULT NOW(),
	"submitted_by_user_id" uuid,
	CONSTRAINT "real_estate_listings_external_id_source_unique" UNIQUE("external_id","source")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token" text NOT NULL,
	"user_id" uuid,
	"expires" timestamp NOT NULL,
	CONSTRAINT "sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "user_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"alert_type" text NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"frequency" text DEFAULT 'daily',
	"is_active" boolean DEFAULT true,
	"last_triggered_at" timestamp,
	"created_at" timestamp DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE "user_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"listing_type" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT NOW(),
	CONSTRAINT "user_favorites_user_id_listing_type_listing_id_unique" UNIQUE("user_id","listing_type","listing_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"name" text,
	"password_hash" text,
	"role" text DEFAULT 'user',
	"color_theme" text DEFAULT 'violett' NOT NULL,
	"created_at" timestamp DEFAULT NOW(),
	"updated_at" timestamp DEFAULT NOW(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_name" text NOT NULL,
	"job_type" text NOT NULL,
	"bundesland" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"items_found" integer DEFAULT 0,
	"items_new" integer DEFAULT 0,
	"items_updated" integer DEFAULT 0,
	"items_failed" integer DEFAULT 0,
	"error_message" text,
	"prefect_run_id" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE "user_login_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT NOW() NOT NULL,
	"last_seen_at" timestamp DEFAULT NOW() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "alert_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"sent_at" timestamp DEFAULT NOW(),
	CONSTRAINT "alert_notifications_alert_id_listing_id_unique" UNIQUE("alert_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE "investor_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"period_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"model_used" text,
	"generated_at" timestamp with time zone DEFAULT NOW() NOT NULL,
	CONSTRAINT "investor_digests_period_period_key_unique" UNIQUE("period","period_key")
);
--> statement-breakpoint
ALTER TABLE "zvg_images" ADD CONSTRAINT "zvg_images_listing_id_zvg_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."zvg_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zvg_ki_analyses" ADD CONSTRAINT "zvg_ki_analyses_listing_id_zvg_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."zvg_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_url_requests" ADD CONSTRAINT "custom_url_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_url_requests" ADD CONSTRAINT "custom_url_requests_listing_id_real_estate_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."real_estate_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_images" ADD CONSTRAINT "real_estate_images_listing_id_real_estate_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."real_estate_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_ki_analyses" ADD CONSTRAINT "real_estate_ki_analyses_listing_id_real_estate_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."real_estate_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_listings" ADD CONSTRAINT "real_estate_listings_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_alerts" ADD CONSTRAINT "user_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_login_sessions" ADD CONSTRAINT "user_login_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_alert_id_user_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."user_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_listing_id_zvg_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."zvg_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_zvg_bundesland" ON "zvg_listings" USING btree ("bundesland");--> statement-breakpoint
CREATE INDEX "idx_zvg_termin" ON "zvg_listings" USING btree ("termin_date");--> statement-breakpoint
CREATE INDEX "idx_zvg_last_seen_at" ON "zvg_listings" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_zvg_scrape_completed_at" ON "zvg_listings" USING btree ("scrape_completed_at");--> statement-breakpoint
CREATE INDEX "idx_zvg_verkehrswert" ON "zvg_listings" USING btree ("verkehrswert");--> statement-breakpoint
CREATE INDEX "idx_zvg_kategorie" ON "zvg_listings" USING btree ("kategorie");--> statement-breakpoint
CREATE INDEX "idx_zvg_slug" ON "zvg_listings" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_zvg_geo" ON "zvg_listings" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "idx_zvg_needs_review" ON "zvg_listings" USING btree ("needs_review");--> statement-breakpoint
CREATE INDEX "idx_zvg_ort_trgm" ON "zvg_listings" USING gin ("ort" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_zvg_adresse_trgm" ON "zvg_listings" USING gin ("adresse" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_real_estate_images_listing_id" ON "real_estate_images" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_user_alerts_user_id" ON "user_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_login_sessions_user_id_idx" ON "user_login_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_alert_notifications_alert_id" ON "alert_notifications" USING btree ("alert_id");