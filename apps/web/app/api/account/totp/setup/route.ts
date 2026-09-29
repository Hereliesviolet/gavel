import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { redis } from "@/lib/redis";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import {
  buildOtpauthUrl,
  encryptTotpSecret,
  generateTotpSecret,
  totpSetupRedisKey,
} from "@/lib/totp";
import { recordAuditEvent } from "@/lib/audit";
import { logServerError } from "@/lib/sentry";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import {
  sessionAuthTime,
  totpEnrollmentBlockedWithoutPassword,
  verifyEnrollmentStepUp,
} from "@/lib/account-step-up";

const schema = z.object({
  password: z.string().optional(),
});

const SETUP_TTL_SECONDS = 10 * 60;
const SETUP_RATE = { max: 5, windowSeconds: 10 * 60, failClosed: true };

export async function POST(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `totp-setup:${session.user.id}`;
  if (await isRateLimited(rateKey, SETUP_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, SETUP_RATE);

  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  const body = json.value;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bitte das aktuelle Passwort angeben." },
      { status: 400 },
    );
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { email: true, totpEnabled: true, passwordHash: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    }
    if (user.totpEnabled) {
      return NextResponse.json(
        { error: "Zwei-Faktor-Authentifizierung ist bereits aktiv." },
        { status: 409 },
      );
    }
    if (totpEnrollmentBlockedWithoutPassword(user.passwordHash)) {
      return NextResponse.json({ error: "Bitte zuerst ein Passwort setzen." }, { status: 400 });
    }
    const stepUp = await verifyEnrollmentStepUp({
      user: {
        id: session.user.id,
        passwordHash: user.passwordHash,
        totpEnabled: user.totpEnabled,
        totpSecret: null,
        totpBackupHashes: null,
      },
      password: parsed.data.password,
      authenticatedAt: sessionAuthTime(session),
      rateKey,
      rate: SETUP_RATE,
    });
    if (!stepUp.ok) return stepUp.response;

    const secret = generateTotpSecret();
    await redis.set(
      totpSetupRedisKey(session.user.id),
      encryptTotpSecret(secret),
      "EX",
      SETUP_TTL_SECONDS,
    );
    await recordAuditEvent({
      actorId: session.user.id,
      action: "totp.setup_start",
      request: req,
    });

    return NextResponse.json({
      secret,
      otpauthUrl: buildOtpauthUrl(secret, user.email),
      expiresInSeconds: SETUP_TTL_SECONDS,
    });
  } catch (error) {
    logServerError("[POST /api/account/totp/setup]", error);
    return NextResponse.json({ error: "Einrichtung nicht möglich" }, { status: 500 });
  }
}
