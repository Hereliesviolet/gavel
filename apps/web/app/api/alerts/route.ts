import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAlerts } from "@/drizzle/schema";
import { count, eq, sql } from "drizzle-orm";
import { enrichAlertCriteria } from "@/lib/alert-geocode";
import { parseAlertFrequency } from "@/lib/alert-frequency";
import {
  MAX_ALERTS_PER_USER,
  parseAlertCriteria,
  parseAlertName,
  parseAlertType,
} from "@/lib/alert-input";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";

const ALERT_WRITE_RATE = { max: 10, windowSeconds: 10 * 60, failClosed: true };

const ALERT_READ_RATE = { max: 30, windowSeconds: 60, failClosed: true };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `alerts-read:${session.user.id}`;
  if (await isRateLimited(rateKey, ALERT_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Alert-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, ALERT_READ_RATE);

  try {
    const alerts = await db.query.userAlerts.findMany({
      where: eq(userAlerts.userId, session.user.id),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
      limit: MAX_ALERTS_PER_USER,
    });
    return NextResponse.json({ alerts });
  } catch (error) {
    console.error("[GET /api/alerts]", error);
    return NextResponse.json({ error: "Datenbankfehler" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `alerts:${session.user.id}`;
  if (await isRateLimited(rateKey, ALERT_WRITE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Alert-Änderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, ALERT_WRITE_RATE);

  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  const body = json.value as Record<string, unknown>;

  try {
    const { name, alertType = "zvg", criteria, frequency = "daily" } = body;
    const parsedFrequency = parseAlertFrequency(frequency);
    const parsedName = parseAlertName(name);
    const parsedCriteria = parseAlertCriteria(criteria);
    const parsedType = parseAlertType(alertType);

    if (!parsedName || !parsedCriteria) {
      return NextResponse.json({ error: "name und criteria sind Pflichtfelder" }, { status: 400 });
    }
    if (!parsedFrequency) {
      return NextResponse.json({ error: "Ungültige Benachrichtigungsfrequenz" }, { status: 400 });
    }
    if (!parsedType) {
      return NextResponse.json({ error: "Ungültiger Alert-Typ" }, { status: 400 });
    }

    const enriched = await enrichAlertCriteria(parsedCriteria);
    if (!enriched.ok) {
      return NextResponse.json({ error: enriched.error }, { status: enriched.status });
    }
    const userId = session.user.id;

    const alert = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`alerts:${userId}`}))`);
      const [existing] = await tx
        .select({ anzahl: count() })
        .from(userAlerts)
        .where(eq(userAlerts.userId, userId));
      if ((existing?.anzahl ?? 0) >= MAX_ALERTS_PER_USER) {
        return null;
      }
      const [created] = await tx
        .insert(userAlerts)
        .values({
          userId,
          alertType: parsedType,
          name: parsedName,
          criteria: enriched.criteria,
          frequency: parsedFrequency,
          isActive: true,
        })
        .returning();
      return created;
    });

    if (!alert) {
      return NextResponse.json(
        { error: `Maximal ${MAX_ALERTS_PER_USER} Alerts pro Konto.` },
        { status: 400 },
      );
    }

    return NextResponse.json({ alert }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/alerts]", error);
    return NextResponse.json({ error: "Fehler beim Erstellen" }, { status: 500 });
  }
}
