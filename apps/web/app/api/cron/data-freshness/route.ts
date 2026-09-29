import { NextRequest, NextResponse } from "next/server";
import { sendDataFreshnessAlertEmail } from "@/lib/email";
import { rejectIfCronUnauthorized } from "@/lib/cron-auth";
import { CRON_JSON_MAX_BYTES, readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { parseDataFreshnessAlert } from "@/lib/data-freshness";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Versendet den Betriebsalarm "Bestand wird nicht mehr aktualisiert" an
 * ADMIN_EMAIL. Die Messung selbst passiert in scrapers/check_freshness.sh -
 * analog zu data-quality-report/route.ts liegt hier ausschließlich der
 * E-Mail-Versand, damit die SMTP-Konfiguration nicht ein zweites Mal außerhalb
 * von lib/email.ts existiert.
 *
 * Bewusst eine eigene Route und kein Anhang an data-quality-report: dieser
 * Report läuft als Schritt 6.5 der daily_pipeline und schweigt damit genau
 * dann mit, wenn die Pipeline gar nicht erst läuft. Ein Wächter darf nicht in
 * dem Prozess wohnen, den er überwacht.
 *
 * Fehlt ADMIN_EMAIL, antwortet die Route mit HTTP 500, damit das aufrufende
 * Skript den fehlgeschlagenen Alarm im Cron-Log sichtbar macht - anders als
 * beim Datenqualitäts-Report, dessen Inhalt auch ohne E-Mail im Prefect-Log
 * vollständig erhalten bleibt.
 */
export async function POST(req: NextRequest) {
  const cronDenied = rejectIfCronUnauthorized(req, "ops");
  if (cronDenied) return cronDenied;

  const json = await readJsonCapped(req, CRON_JSON_MAX_BYTES);
  if (!json.ok) return rejectCappedJson(json, "Ungültiger JSON-Body");
  const raw = json.value;

  const body = parseDataFreshnessAlert(raw);
  if (!body) {
    return NextResponse.json({ error: "Ungültiger Frische-Alarm" }, { status: 400 });
  }

  if (!ADMIN_EMAIL) {
    return NextResponse.json(
      { sent: false, reason: "ADMIN_EMAIL ist nicht konfiguriert" },
      { status: 500 },
    );
  }

  try {
    await sendDataFreshnessAlertEmail({
      to: ADMIN_EMAIL,
      aktiveObjekte: body.aktiveObjekte,
      letzterSchreibzeitpunkt: body.letzterSchreibzeitpunkt ?? null,
      alterMinuten: body.alterMinuten ?? null,
      schwelleStunden: body.schwelleStunden,
    });
    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[POST /api/cron/data-freshness]", err);
    return NextResponse.json(
      { sent: false, reason: "E-Mail-Versand fehlgeschlagen" },
      { status: 500 },
    );
  }
}
