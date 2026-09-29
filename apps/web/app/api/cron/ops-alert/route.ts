import { NextRequest, NextResponse } from "next/server";
import { rejectIfCronUnauthorized } from "@/lib/cron-auth";
import { CRON_JSON_MAX_BYTES, readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { sendOpsAlertEmail } from "@/lib/email";
import { formatOpsAlerts, parseOpsAlertPayload } from "@/lib/ops-alert";
import { logServerError } from "@/lib/sentry";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export async function POST(req: NextRequest) {
  const cronDenied = rejectIfCronUnauthorized(req, "ops");
  if (cronDenied) return cronDenied;

  if (!ADMIN_EMAIL) {
    return NextResponse.json(
      { sent: false, reason: "ADMIN_EMAIL ist nicht konfiguriert" },
      { status: 500 },
    );
  }

  const json = await readJsonCapped(req, CRON_JSON_MAX_BYTES);
  if (!json.ok) return rejectCappedJson(json, "Ungültiger JSON-Body");
  const raw = json.value;

  const payload = parseOpsAlertPayload(raw);
  if (!payload) {
    return NextResponse.json({ error: "Ungültiger Alert-Body" }, { status: 400 });
  }

  const { title, body: text } = formatOpsAlerts(payload);
  try {
    await sendOpsAlertEmail({ to: ADMIN_EMAIL, title, body: text });
    return NextResponse.json({ sent: true });
  } catch (error) {
    logServerError("[POST /api/cron/ops-alert]", error);
    return NextResponse.json(
      { sent: false, reason: "E-Mail-Versand fehlgeschlagen" },
      { status: 500 },
    );
  }
}
