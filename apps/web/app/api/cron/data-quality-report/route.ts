import { NextRequest, NextResponse } from "next/server";
import { sendDataQualityReportEmail } from "@/lib/email";
import { rejectIfCronUnauthorized } from "@/lib/cron-auth";
import { CRON_JSON_MAX_BYTES, readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { parseDataQualityReport } from "@/lib/data-quality-report";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Empfängt die Tageszusammenfassung der Datenqualitätsprüfung vom Prefect-
 * Flow (scrapers/src/flows/data_quality.py, generate_data_quality_report_task)
 * und versendet - analog zu /api/cron/check-alerts - eine HTML-E-Mail über
 * die bestehende SMTP-Infrastruktur (lib/email.ts). Aggregation/Persistenz
 * der Statistik selbst passiert bereits in Python (data_quality_daily_stats);
 * diese Route ist ausschließlich für den E-Mail-Versand zuständig, damit
 * SMTP-Zugangsdaten/Template nicht ein zweites Mal in Python dupliziert
 * werden müssen (siehe Kommentar in check-alerts/route.ts).
 *
 * Fail-open bei fehlendem ADMIN_EMAIL: die Prüfung/Persistenz selbst lief
 * bereits erfolgreich (Log-Ausgabe im Prefect-Flow bleibt in jedem Fall
 * sichtbar) - nur der zusätzliche E-Mail-Versand wird übersprungen.
 */
export async function POST(req: NextRequest) {
  const cronDenied = rejectIfCronUnauthorized(req, "ops");
  if (cronDenied) return cronDenied;

  const json = await readJsonCapped(req, CRON_JSON_MAX_BYTES);
  if (!json.ok) return rejectCappedJson(json, "Ungültiger JSON-Body");
  const raw = json.value;

  const payload = parseDataQualityReport(raw);
  if (!payload) {
    return NextResponse.json({ error: "Ungültiger Report-Body" }, { status: 400 });
  }

  if (!ADMIN_EMAIL) {
    return NextResponse.json({
      sent: false,
      reason: "ADMIN_EMAIL ist nicht konfiguriert - Report nur als Prefect-Log sichtbar.",
    });
  }

  const { summary, previous } = payload;
  try {
    await sendDataQualityReportEmail({
      to: ADMIN_EMAIL,
      totalActive: summary.total_active,
      totalNeedsReview: summary.total_needs_review,
      previousTotalNeedsReview: previous?.total_needs_review ?? null,
      bySource: summary.by_source,
      topReasons: summary.by_reason.slice(0, 10),
      dashboardUrl: process.env.NEXTAUTH_URL
        ? `${process.env.NEXTAUTH_URL}/investor/datenbasis`
        : undefined,
    });
    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[POST /api/cron/data-quality-report]", err);
    return NextResponse.json(
      { sent: false, reason: "E-Mail-Versand fehlgeschlagen" },
      { status: 500 },
    );
  }
}
