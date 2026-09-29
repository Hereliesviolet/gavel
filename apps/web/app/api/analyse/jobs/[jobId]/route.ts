import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { customUrlRequests } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { visibleAnalyseListingIds } from "@/lib/analyse-access";
import { serializeAnalyseJob } from "@/lib/analyse-jobs";
import { isValidUuid } from "@/lib/utils";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const JOB_POLL_RATE = { max: 400, windowSeconds: 60, failClosed: true };

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `analyse-poll:${session.user.id}`;
  if (await isRateLimited(rateKey, JOB_POLL_RATE)) {
    return NextResponse.json({ error: "Zu viele Status-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, JOB_POLL_RATE);

  const { jobId } = await params;
  if (!isValidUuid(jobId)) {
    return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
  }

  try {
    const [row] = await db
      .select()
      .from(customUrlRequests)
      .where(and(eq(customUrlRequests.id, jobId), eq(customUrlRequests.userId, session.user.id)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
    }

    const visibleListingIds = await visibleAnalyseListingIds(session.user.id, [row.listingId]);
    return NextResponse.json(serializeAnalyseJob(row, visibleListingIds));
  } catch (error) {
    console.error("[GET /api/analyse/jobs/[jobId]]", error);
    return NextResponse.json({ error: "Datenbankfehler" }, { status: 500 });
  }
}
