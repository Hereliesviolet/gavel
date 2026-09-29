import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userLoginSessions } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { markSessionRevoked } from "@/lib/session-revocation";
import { isValidUuid } from "@/lib/utils";
import { recordAuditEvent } from "@/lib/audit";
import { logServerError } from "@/lib/sentry";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";

const SESSION_RATE = { max: 10, windowSeconds: 10 * 60, failClosed: true };

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }
  const userId = session.user.id;

  const { id } = await params;
  const currentSid = (session as unknown as { sessionId?: string }).sessionId;

  const rateKey = `sessions:${userId}`;
  if (await isRateLimited(rateKey, SESSION_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Sitzungsänderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, SESSION_RATE);

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });
  }

  if (id === currentSid) {
    return NextResponse.json(
      { error: "Die aktuelle Sitzung kann hier nicht beendet werden. Bitte 'Abmelden' verwenden." },
      { status: 400 },
    );
  }

  try {
    const revoked = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(userLoginSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userLoginSessions.id, id), eq(userLoginSessions.userId, userId)))
        .returning({ id: userLoginSessions.id });
      if (!row) return null;
      await recordAuditEvent({
        actorId: userId,
        action: "session.revoke",
        target: id,
        request: req,
        executor: tx,
      });
      return row;
    });

    if (!revoked) {
      return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });
    }

    // Widerruf sofort ins globale Auth-Gate
    // propagieren (siehe proxy.ts / lib/session-revocation.ts), statt darauf
    // zu warten, dass irgendwann der nächste auth()-Aufruf des betroffenen
    // Geräts die DB erneut liest. Bewusst NACH dem erfolgreichen DB-Update,
    // damit hier kein Redis-Eintrag ohne zugehörigen DB-Zustand entsteht.
    try {
      await markSessionRevoked(id);
    } catch (error) {
      logServerError("[DELETE /api/account/sessions/[id]] Redis", error);
      return NextResponse.json(
        {
          error:
            "Sitzung ist gesperrt, die Sperre konnte aber nicht überall vermerkt werden. Bitte erneut versuchen.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logServerError("[DELETE /api/account/sessions/[id]]", error);
    return NextResponse.json({ error: "Fehler beim Widerrufen" }, { status: 500 });
  }
}
