import { NextRequest, NextResponse } from "next/server";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { userLoginSessions } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { markSessionRevoked } from "@/lib/session-revocation";

export async function POST(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  let sid: string | undefined;
  let userId: string | undefined;
  try {
    const session = await auth();
    sid = (session as unknown as { sessionId?: string })?.sessionId;
    userId = session?.user?.id;
  } catch (e) {
    console.error("[POST /api/auth/logout] Sitzung konnte nicht gelesen werden", e);
  }

  if (sid) {
    try {
      await db
        .update(userLoginSessions)
        .set({ revokedAt: new Date() })
        .where(
          userId
            ? and(eq(userLoginSessions.id, sid), eq(userLoginSessions.userId, userId))
            : eq(userLoginSessions.id, sid),
        );
    } catch (e) {
      console.error("[POST /api/auth/logout] DB-Widerruf fehlgeschlagen", e);
      return NextResponse.json(
        { error: "Abmelden fehlgeschlagen. Bitte erneut versuchen." },
        { status: 503 },
      );
    }
    try {
      await markSessionRevoked(sid);
    } catch (e) {
      console.error("[POST /api/auth/logout] Redis-Widerruf fehlgeschlagen", e);
    }
  }

  await signOut({ redirect: false });
  return NextResponse.json({ success: true });
}
