import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { isRateLimited, recordRateLimitHit, clearRateLimit } from "@/lib/rate-limit";
import { generateBackupCodes, hashBackupCode } from "@/lib/totp";
import { recordAuditEvent } from "@/lib/audit";
import { logServerError } from "@/lib/sentry";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { lockAccountAndReverifySensitive } from "@/lib/account-lock";
import { isStepUpConsumedError, verifySensitiveStepUp } from "@/lib/account-step-up";
import { commitSensitiveAccountChange } from "@/lib/session-revocation";

const REGEN_RATE = { max: 5, windowSeconds: 10 * 60, failClosed: true };

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

  const rateKey = `totp-backup:${session.user.id}`;
  if (await isRateLimited(rateKey, REGEN_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, REGEN_RATE);

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
      rate: REGEN_RATE,
    });
    if (!stepUp.ok) return stepUp.response;

    const backupCodes = generateBackupCodes();
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
            totpBackupHashes: backupCodes.map(hashBackupCode),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
        await recordAuditEvent({
          actorId: userId,
          action: "totp.backup_regenerate",
          request: req,
          executor: tx,
        });
      },
      userId,
      currentSid,
    );

    await clearRateLimit(rateKey, REGEN_RATE);

    return NextResponse.json({ backupCodes });
  } catch (error) {
    if (isStepUpConsumedError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Der Code ist ungültig." },
        { status: 400 },
      );
    }
    logServerError("[POST /api/account/totp/backup/regenerate]", error);
    return NextResponse.json({ error: "Codes konnten nicht erzeugt werden" }, { status: 500 });
  }
}
