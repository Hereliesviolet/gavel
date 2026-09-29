import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { customUrlRequests } from "@/drizzle/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { visibleAnalyseListingIds } from "@/lib/analyse-access";
import { serializeAnalyseJob } from "@/lib/analyse-jobs";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const JOB_POLL_RATE = { max: 400, windowSeconds: 60, failClosed: true };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `analyse-poll:${session.user.id}`;
  if (await isRateLimited(rateKey, JOB_POLL_RATE)) {
    return NextResponse.json({ error: "Zu viele Status-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, JOB_POLL_RATE);

  try {
    const active = await db
      .select()
      .from(customUrlRequests)
      .where(
        and(
          eq(customUrlRequests.userId, session.user.id),
          inArray(customUrlRequests.status, ["queued", "running"]),
        ),
      )
      .orderBy(desc(customUrlRequests.requestedAt), desc(customUrlRequests.id))
      .limit(5);

    const recentDone = await db
      .select()
      .from(customUrlRequests)
      .where(
        and(
          eq(customUrlRequests.userId, session.user.id),
          or(eq(customUrlRequests.status, "success"), eq(customUrlRequests.status, "error")),
        ),
      )
      .orderBy(desc(customUrlRequests.updatedAt), desc(customUrlRequests.id))
      .limit(3);

    const visibleListingIds = await visibleAnalyseListingIds(session.user.id, [
      ...active.map((row) => row.listingId),
      ...recentDone.map((row) => row.listingId),
    ]);

    return NextResponse.json({
      jobs: active.map((row) => serializeAnalyseJob(row, visibleListingIds)),
      recent: recentDone.map((row) => serializeAnalyseJob(row, visibleListingIds)),
    });
  } catch (error) {
    console.error("[GET /api/analyse/jobs]", error);
    return NextResponse.json({ error: "Datenbankfehler" }, { status: 500 });
  }
}
