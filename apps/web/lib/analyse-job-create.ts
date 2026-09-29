import { and, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customUrlRequests, realEstateListings } from "@/drizzle/schema";
import {
  ACCEPTED_STALE_ANALYSE_JOB_MINUTES,
  analyseDailyLimit,
  isAnalyseJobHandoffTerminal,
  publicJobErrorMessage,
  STALE_ANALYSE_JOB_MINUTES,
} from "@/lib/analyse-jobs";

export { ACCEPTED_STALE_ANALYSE_JOB_MINUTES, analyseDailyLimit, STALE_ANALYSE_JOB_MINUTES };

export const MAX_ACTIVE_JOBS_PER_USER = 2;
export const ANALYSE_HISTORY_KEEP_SUCCESS = 200;
export const ANALYSE_ERROR_RETENTION_DAYS = 90;

export class AnalyseDailyQuotaExceeded extends Error {
  constructor(readonly limit: number) {
    super(`Tageslimit von ${limit} Analysen erreicht`);
    this.name = "AnalyseDailyQuotaExceeded";
  }
}

export type CreateAnalyseJobResult = { ok: true; jobId: string } | { ok: false; reason: "active" };

export async function reapStaleAnalyseJobsForUser(userId: string): Promise<void> {
  await db.execute(sql`
    UPDATE custom_url_requests
    SET status = 'error',
        step = 'failed',
        step_detail = 'Analyse abgebrochen (Timeout)',
        error_message = 'Job hing länger als erwartet und wurde automatisch beendet',
        updated_at = NOW()
    WHERE user_id = ${userId}::uuid
      AND status IN ('queued', 'running')
      AND (
        COALESCE(updated_at, requested_at)
          < NOW() - (${STALE_ANALYSE_JOB_MINUTES}::text || ' minutes')::interval
        OR (
          COALESCE(step, 'queued') = 'accepted'
          AND listing_id IS NULL
          AND COALESCE(updated_at, requested_at)
            < NOW() - (${ACCEPTED_STALE_ANALYSE_JOB_MINUTES}::text || ' minutes')::interval
        )
      )
  `);
}

export async function tryCreateAnalyseJob(
  userId: string,
  url: string,
  maxPerDay = analyseDailyLimit(),
  usedSessionCookie = false,
  listingId?: string | null,
): Promise<CreateAnalyseJobResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`analyse-jobs:${userId}`}))`);

    let boundListingId = listingId ?? null;
    if (boundListingId) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`listing-delete:${boundListingId}`}))`,
      );
      const [existing] = await tx
        .select({ id: realEstateListings.id })
        .from(realEstateListings)
        .where(eq(realEstateListings.id, boundListingId))
        .limit(1);
      if (!existing?.id) boundListingId = null;
    }

    await tx.execute(sql`
      DELETE FROM custom_url_requests
      WHERE user_id = ${userId}::uuid
        AND status = 'success'
        AND id NOT IN (
          SELECT id FROM (
            SELECT id FROM custom_url_requests
            WHERE user_id = ${userId}::uuid
              AND status = 'success'
            ORDER BY COALESCE(requested_at, updated_at) DESC NULLS LAST
            LIMIT ${ANALYSE_HISTORY_KEEP_SUCCESS}
          ) keep_success
        )
        AND (
          listing_id IS NULL
          OR id NOT IN (
            SELECT DISTINCT ON (listing_id) id
            FROM custom_url_requests
            WHERE user_id = ${userId}::uuid
              AND status = 'success'
              AND listing_id IS NOT NULL
            ORDER BY listing_id, COALESCE(requested_at, updated_at) DESC NULLS LAST, id DESC
          )
        )
    `);
    await tx.execute(sql`
      DELETE FROM custom_url_requests
      WHERE user_id = ${userId}::uuid
        AND status = 'error'
        AND COALESCE(requested_at, updated_at)
          < NOW() - (${ANALYSE_ERROR_RETENTION_DAYS}::text || ' days')::interval
    `);

    const [used] = await tx
      .select({ n: count() })
      .from(customUrlRequests)
      .where(
        and(
          eq(customUrlRequests.userId, userId),
          sql`COALESCE(${customUrlRequests.requestedAt}, ${customUrlRequests.updatedAt})
            > NOW() - INTERVAL '24 hours'`,
        ),
      );
    if (Number(used?.n ?? 0) >= maxPerDay) {
      throw new AnalyseDailyQuotaExceeded(maxPerDay);
    }

    const [active] = await tx
      .select({ n: count() })
      .from(customUrlRequests)
      .where(
        and(
          eq(customUrlRequests.userId, userId),
          inArray(customUrlRequests.status, ["queued", "running"]),
        ),
      );
    if (Number(active?.n ?? 0) >= MAX_ACTIVE_JOBS_PER_USER) {
      return { ok: false, reason: "active" as const };
    }

    const prepared = usedSessionCookie
      ? "Analyse vorbereitet · eingefügte Sitzung"
      : "Analyse vorbereitet";
    const [row] = await tx
      .insert(customUrlRequests)
      .values({
        userId,
        url,
        listingId: boundListingId,
        status: "queued",
        step: "queued",
        progressPct: 0,
        stepDetail: prepared,
        stepLog: [
          {
            t: new Date().toISOString(),
            msg: prepared,
            kind: "line",
          },
        ],
      })
      .returning({ id: customUrlRequests.id });

    if (!row?.id) {
      throw new Error("Analyse-Job konnte nicht angelegt werden");
    }
    return { ok: true, jobId: row.id };
  });
}

export async function failQueuedAnalyseJob(jobId: string, message: string): Promise<boolean> {
  const safe = publicJobErrorMessage(message) ?? "Analyse konnte nicht gestartet werden";
  const [updated] = await db
    .update(customUrlRequests)
    .set({
      status: "error",
      step: "failed",
      stepDetail: safe.slice(0, 120),
      errorMessage: safe,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customUrlRequests.id, jobId),
        inArray(customUrlRequests.status, ["queued", "running"]),
        or(
          eq(customUrlRequests.status, "queued"),
          inArray(customUrlRequests.step, ["queued", "accepted"]),
          isNull(customUrlRequests.step),
        ),
      ),
    )
    .returning({ id: customUrlRequests.id });
  if (updated?.id) return true;

  const [existing] = await db
    .select({ status: customUrlRequests.status })
    .from(customUrlRequests)
    .where(eq(customUrlRequests.id, jobId))
    .limit(1);
  return isAnalyseJobHandoffTerminal(existing?.status);
}
