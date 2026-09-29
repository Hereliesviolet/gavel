import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAlerts } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { enrichAlertCriteria, type AlertCriteriaWithGeo } from "@/lib/alert-geocode";
import { isValidUuid } from "@/lib/utils";
import { parseAlertFrequency } from "@/lib/alert-frequency";
import { parseAlertCriteria, parseAlertName, parseOptionalAlertActive } from "@/lib/alert-input";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";

const ALERT_WRITE_RATE = { max: 10, windowSeconds: 10 * 60, failClosed: true };

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Alert nicht gefunden" }, { status: 404 });
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
    const { name, criteria, frequency, isActive } = body;
    const parsedFrequency = frequency === undefined ? undefined : parseAlertFrequency(frequency);
    if (frequency !== undefined && !parsedFrequency) {
      return NextResponse.json({ error: "Ungültige Benachrichtigungsfrequenz" }, { status: 400 });
    }
    const parsedName = name === undefined ? undefined : parseAlertName(name);
    if (name !== undefined && !parsedName) {
      return NextResponse.json({ error: "Ungültiger Alert-Name" }, { status: 400 });
    }
    const parsedCriteria = criteria === undefined ? undefined : parseAlertCriteria(criteria);
    if (criteria !== undefined && !parsedCriteria) {
      return NextResponse.json({ error: "Ungültige Alert-Kriterien" }, { status: 400 });
    }
    const parsedActive = parseOptionalAlertActive(isActive);
    if (!parsedActive.ok) {
      return NextResponse.json({ error: "Ungültiger Aktiv-Status" }, { status: 400 });
    }

    const existing = await db.query.userAlerts.findFirst({
      where: and(eq(userAlerts.id, id), eq(userAlerts.userId, session.user.id)),
    });
    if (!existing) {
      return NextResponse.json({ error: "Alert nicht gefunden" }, { status: 404 });
    }

    let enrichedCriteria = parsedCriteria;
    if (parsedCriteria) {
      const stored =
        existing.criteria &&
        typeof existing.criteria === "object" &&
        !Array.isArray(existing.criteria)
          ? (existing.criteria as AlertCriteriaWithGeo)
          : null;
      const enriched = await enrichAlertCriteria(parsedCriteria, stored);
      if (!enriched.ok) {
        return NextResponse.json({ error: enriched.error }, { status: enriched.status });
      }
      enrichedCriteria = enriched.criteria;
    }

    const [updated] = await db
      .update(userAlerts)
      .set({
        ...(parsedName ? { name: parsedName } : {}),
        ...(enrichedCriteria ? { criteria: enrichedCriteria } : {}),
        ...(parsedFrequency ? { frequency: parsedFrequency } : {}),
        ...(parsedActive.value !== undefined ? { isActive: parsedActive.value } : {}),
      })
      .where(and(eq(userAlerts.id, id), eq(userAlerts.userId, session.user.id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Alert nicht gefunden" }, { status: 404 });
    }

    return NextResponse.json({ alert: updated });
  } catch (error) {
    console.error("[PUT /api/alerts/[id]]", error);
    return NextResponse.json({ error: "Fehler beim Aktualisieren" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Alert nicht gefunden" }, { status: 404 });
  }

  const rateKey = `alerts:${session.user.id}`;
  if (await isRateLimited(rateKey, ALERT_WRITE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Alert-Änderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, ALERT_WRITE_RATE);

  try {
    const [deleted] = await db
      .delete(userAlerts)
      .where(and(eq(userAlerts.id, id), eq(userAlerts.userId, session.user.id)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Alert nicht gefunden" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/alerts/[id]]", error);
    return NextResponse.json({ error: "Fehler beim Löschen" }, { status: 500 });
  }
}
