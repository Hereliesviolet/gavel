import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const scrapeJobs = pgTable("scrape_jobs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  flowName: text("flow_name").notNull(),
  jobType: text("job_type").notNull(),
  bundesland: text("bundesland"),
  status: text("status").notNull().default("pending"),
  itemsFound: integer("items_found").default(0),
  itemsNew: integer("items_new").default(0),
  itemsUpdated: integer("items_updated").default(0),
  itemsFailed: integer("items_failed").default(0),
  errorMessage: text("error_message"),
  prefectRunId: text("prefect_run_id"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").default(sql`NOW()`),
});
