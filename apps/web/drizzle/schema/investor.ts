import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  unique,
  integer,
  decimal,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { zvgListings } from "./zvg";

export const investorProfiles = pgTable(
  "investor_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strategies: jsonb("strategies")
      .notNull()
      .default(sql`'["buy_hold","fix_flip","unter_markt"]'::jsonb`),
    maxEquityEur: integer("max_equity_eur").notNull().default(150000),
    targetIrrPct: decimal("target_irr_pct", { precision: 6, scale: 2 }).notNull().default("12"),
    targetCashOnCashPct: decimal("target_cash_on_cash_pct", { precision: 6, scale: 2 })
      .notNull()
      .default("6"),
    targetFlipMarginPct: decimal("target_flip_margin_pct", { precision: 6, scale: 2 })
      .notNull()
      .default("15"),
    minDscr: decimal("min_dscr", { precision: 5, scale: 2 }).notNull().default("1.2"),
    financingRatePct: decimal("financing_rate_pct", { precision: 6, scale: 2 })
      .notNull()
      .default("4.5"),
    repaymentRatePct: decimal("repayment_rate_pct", { precision: 6, scale: 2 })
      .notNull()
      .default("2"),
    equityPct: decimal("equity_pct", { precision: 6, scale: 2 }).notNull().default("20"),
    maxHoldingMonths: integer("max_holding_months").notNull().default(12),
    vacancyPct: decimal("vacancy_pct", { precision: 6, scale: 2 }).notNull().default("4"),
    maintenanceEurM2Year: decimal("maintenance_eur_m2_year", { precision: 8, scale: 2 })
      .notNull()
      .default("15"),
    regions: jsonb("regions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    propertyTypes: jsonb("property_types")
      .notNull()
      .default(sql`'[]'::jsonb`),
    renovationCapacity: text("renovation_capacity").notNull().default("medium"),
    riskTolerance: text("risk_tolerance").notNull().default("balanced"),
    profileVersion: text("profile_version").notNull().default("investor-profile-v1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => ({
    uniqueUser: unique("investor_profiles_user_id_unique").on(t.userId),
  }),
);

export const investorEvaluationRuns = pgTable(
  "investor_evaluation_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    qualityRulesVersion: text("quality_rules_version").notNull(),
    underwritingVersion: text("underwriting_version").notNull(),
    datasetVersion: text("dataset_version").notNull(),
    sampleSize: integer("sample_size").notNull(),
    status: text("status").notNull(),
    metrics: jsonb("metrics").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => ({
    idxCreated: index("idx_investor_evaluation_runs_created").on(t.createdAt),
  }),
);

export const investorAnalysisFeedback = pgTable(
  "investor_analysis_feedback",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => zvgListings.id, { onDelete: "cascade" }),
    verdict: text("verdict").notNull(),
    strategy: text("strategy"),
    comment: text("comment"),
    analysisVersion: text("analysis_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => ({
    uniqueUserListingVersion: unique("investor_feedback_user_listing_version_unique").on(
      t.userId,
      t.listingId,
      t.analysisVersion,
    ),
    idxListing: index("idx_investor_analysis_feedback_listing").on(t.listingId),
  }),
);

export const investorDealOutcomes = pgTable(
  "investor_deal_outcomes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => zvgListings.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    strategy: text("strategy"),
    actualBidEur: integer("actual_bid_eur"),
    actualPurchasePriceEur: integer("actual_purchase_price_eur"),
    actualRenovationEur: integer("actual_renovation_eur"),
    actualHoldingMonths: integer("actual_holding_months"),
    actualMonthlyRentEur: integer("actual_monthly_rent_eur"),
    actualSalePriceEur: integer("actual_sale_price_eur"),
    notes: text("notes"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => ({
    uniqueUserListing: unique("investor_deal_outcomes_user_listing_unique").on(
      t.userId,
      t.listingId,
    ),
    idxStatus: index("idx_investor_deal_outcomes_status").on(t.status),
  }),
);
