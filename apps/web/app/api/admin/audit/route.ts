import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents } from "@/drizzle/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/authz";
import { logServerError } from "@/lib/sentry";
import { ADMIN_READ_RATE, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error || !session?.user?.id) {
    return NextResponse.json({ error }, { status: error === "Nicht eingeloggt" ? 401 : 403 });
  }

  const rateKey = `admin-audit:${session.user.id}`;
  if (await isRateLimited(rateKey, ADMIN_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Audit-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, ADMIN_READ_RATE);

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  try {
    const events = await db
      .select({
        id: auditEvents.id,
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        target: auditEvents.target,
        ipAddress: auditEvents.ipAddress,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
    await recordAuditEvent({
      actorId: session.user.id,
      action: "admin.audit.read",
      request: req,
      metadata: { limit },
    });
    return NextResponse.json({ events });
  } catch (e) {
    logServerError("[GET /api/admin/audit]", e);
    return NextResponse.json({ error: "Audit-Log nicht lesbar" }, { status: 500 });
  }
}
