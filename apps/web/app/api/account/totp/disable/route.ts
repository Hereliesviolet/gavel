import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { isRateLimited, recordRateLimitHit, clearRateLimit } from "@/lib/rate-limit";
import { commitSensitiveAccountChange } from "@/lib/session-revocation";
import { recordAuditEvent } from "@/lib/audit";
import { logServerError } from "@/lib/sentry";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { lockAccountAndReverifySensitive } from "@/lib/account-lock";
import { isStepUpConsumedError, verifySensitiveStepUp } from "@/lib/account-step-up";

const DISABLE_RATE = { max: 5, windowSeconds: 10 * 60, failClosed: true };

const schema = z.object({
  password: z.string().optional(),
  code: z.string().min(6, "Bitte den Einmalcode oder einen Wiederherstellungscode angeben."),
});

export async function POST(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `totp-disable:${session.user.id}`;
  if (await isRateLimited(rateKey, DISABLE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, DISABLE_RATE);

  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  const body = json.value;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" },
      { status: 400 },
    );
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });
    if (!user) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    }
    if (!user.totpEnabled) {
      return NextResponse.json(
        { error: "Zwei-Faktor-Authentifizierung ist nicht aktiv." },
        { status: 409 },
      );
    }

    const stepUp = await verifySensitiveStepUp({
      user,
      password: parsed.data.password,
      totpCode: parsed.data.code,
      rateKey,
      rate: DISABLE_RATE,
    });
    if (!stepUp.ok) return stepUp.response;

    const userId = session.user.id;
    const currentSid = (session as unknown as { sessionId?: string }).sessionId;
    await commitSensitiveAccountChange(
      async (tx) => {
        await lockAccountAndReverifySensitive(tx, userId, {
          password: parsed.data.password,
          totpCode: parsed.data.code,
        });
        await tx
          .update(users)
          .set({
            totpSecret: null,
            totpEnabled: false,
            totpConfirmedAt: null,
            totpBackupHashes: null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
        await recordAuditEvent({
          actorId: userId,
          action: "totp.disable",
          request: req,
          executor: tx,
        });
      },
      userId,
      currentSid,
    );

    await clearRateLimit(rateKey, DISABLE_RATE);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isStepUpConsumedError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Der Code ist ungültig." },
        { status: 400 },
      );
    }
    logServerError("[POST /api/account/totp/disable]", error);
    return NextResponse.json({ error: "Deaktivieren nicht möglich" }, { status: 500 });
  }
}
