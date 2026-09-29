import nodemailer from "nodemailer";
import { siteUrl } from "@/lib/site-url";
import { isSafeEmailConfirmUrl } from "@/lib/email-change";
import { isSafePublicHttpsUrl, publicListingImageUrl } from "@/lib/safe-url";
import { formatDate as formatDateBerlin } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";

/**
 * Zentrale E-Mail-Infrastruktur für Gavel.
 *
 * Versand läuft über einen eigenen SMTP-Mailaccount (siehe .env: SMTP_*),
 * NICHT mehr über Resend (RESEND_API_KEY ist nicht mehr verwendet).
 *
 * `sendMail()` ist die generische Basis-Funktion für beliebige Transaktions-
 * E-Mails (Alerts, künftig z.B. Passwort-Reset, E-Mail-Verifizierung, ...).
 * `sendAlertEmail()` baut darauf auf und ist auf ZVG-Alert-Benachrichtigungen
 * spezialisiert.
 */

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true"; // false = STARTTLS (Port 587), true = implizites SSL (Port 465)
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP ist nicht konfiguriert (SMTP_HOST/SMTP_USER/SMTP_PASSWORD fehlen in der Umgebung).",
    );
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransporter;
}

export interface SendMailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

/** Generische Basis-Funktion für den Versand einer beliebigen HTML-E-Mail. */
export async function sendMail({ to, subject, html, text, replyTo }: SendMailParams) {
  const from = process.env.SMTP_FROM ?? '"Gavel" <noreply@example.com>';
  const transporter = getTransporter();

  return transporter.sendMail({
    from,
    to,
    subject,
    html,
    text: text ?? htmlToPlainTextFallback(html),
    replyTo,
  });
}

export function htmlToPlainTextFallback(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(
      /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, _quote, href, label) => {
        const text = String(label)
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        const url = String(href).trim();
        if (!url || /^\s*(javascript|data):/i.test(url)) return text;
        if (!text || text === url) return url;
        return `${text} ${url}`;
      },
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dunkles E-Mail-Grundgerüst im Carbon/M3-Look der App (siehe app/globals.css,
 * --primary/--background im Dark-Theme). E-Mail-Clients unterstützen weder
 * CSS-Variablen noch oklch() zuverlässig, daher hier als feste Hex-Werte,
 * die visuell an das App-Theme angelehnt sind. Tabellen-Layout statt Flex/
 * Grid, da viele Mail-Clients modernes CSS nicht unterstützen.
 */
function renderEmailShell(opts: { title: string; bodyHtml: string; preheader?: string }): string {
  const { title, bodyHtml, preheader } = opts;
  const baseUrl = siteUrl();

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0d14;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#1a1721;border-radius:16px;overflow:hidden;border:1px solid #2c2735;">
          <tr>
            <td style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">
                      Gavel
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#e7e4ed;font-size:15px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #2c2735;">
              <p style="margin:0;font-size:12px;color:#8a8496;">
                Gavel &middot; automatisierte Benachrichtigung &middot;
                <a href="${baseUrl}/account/alerts" style="color:#a78bfa;text-decoration:none;">Alerts verwalten</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isSafeAlertPathSegment(value: string | null | undefined): boolean {
  return Boolean(value && value.length <= 200 && /^[a-z0-9][a-z0-9-]*$/i.test(value));
}

export function isSafeAlertImageUrl(url: string | null | undefined): url is string {
  return Boolean(publicListingImageUrl(url)?.startsWith("/zvg-images/"));
}

export function publicAlertImageUrl(
  url: string | null | undefined,
  baseUrl: string,
): string | null {
  const path = publicListingImageUrl(url);
  if (!path?.startsWith("/zvg-images/")) return null;
  return `${baseUrl}${path}`;
}

export interface AlertListingItem {
  typ: string;
  adresse: string;
  verkehrswert: number | null;
  slug: string;
  bundesland: string;
  imageUrl?: string | null;
  amtsgericht?: string | null;
  terminDate?: Date | null;
}

export interface SendAlertEmailParams {
  to: string;
  userName: string;
  alertName: string;
  listings: AlertListingItem[];
}

function formatEur(v: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatDate(d?: Date | null) {
  if (!d) return null;
  const formatted = formatDateBerlin(d);
  return formatted === "—" ? null : formatted;
}

export interface DataQualityReportParams {
  to: string;
  totalActive: number;
  totalNeedsReview: number;
  previousTotalNeedsReview?: number | null;
  bySource: Record<string, number>;
  topReasons: { field: string; reason: string; count: number }[];
  dashboardUrl?: string;
}

/**
 * Täglicher Datenqualitäts-Report (2026-07-04, siehe
 * scrapers/src/flows/data_quality.py + docs/DATA_QUALITY.md). Nutzt
 * dieselbe SMTP-Infrastruktur/Shell wie sendAlertEmail() - bewusst kein
 * zweiter, unabhängiger Versandweg.
 */
export async function sendDataQualityReportEmail(params: DataQualityReportParams) {
  const {
    to,
    totalActive,
    totalNeedsReview,
    previousTotalNeedsReview,
    bySource,
    topReasons,
    dashboardUrl,
  } = params;

  const pct = totalActive > 0 ? (totalNeedsReview / totalActive) * 100 : 0;

  let trendHtml = "";
  if (previousTotalNeedsReview != null) {
    const delta = totalNeedsReview - previousTotalNeedsReview;
    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "▬";
    const color = delta > 0 ? "#f87171" : delta < 0 ? "#4ade80" : "#a9a4b6";
    trendHtml = `<span style="color:${color};font-weight:600;">${arrow} ${delta > 0 ? "+" : ""}${delta} vs. Vortag</span>`;
  }

  const bySourceRows = Object.entries(bySource)
    .map(
      ([source, count]) => `
      <tr>
        <td style="padding:6px 12px;color:#e7e4ed;border-bottom:1px solid #2c2735;">${escapeHtml(source)}</td>
        <td style="padding:6px 12px;color:#e7e4ed;border-bottom:1px solid #2c2735;text-align:right;">${count}</td>
      </tr>`,
    )
    .join("");

  const reasonRows = topReasons
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 12px;color:#e7e4ed;border-bottom:1px solid #2c2735;">${escapeHtml(r.field)}</td>
        <td style="padding:6px 12px;color:#a9a4b6;border-bottom:1px solid #2c2735;">${escapeHtml(r.reason)}</td>
        <td style="padding:6px 12px;color:#e7e4ed;border-bottom:1px solid #2c2735;text-align:right;">${r.count}</td>
      </tr>`,
    )
    .join("");

  const bodyHtml = `
    <h1 style="margin:0 0 4px 0;font-size:19px;color:#f2f0f6;">Datenqualitäts-Report</h1>
    <p style="margin:0 0 20px 0;color:#a9a4b6;">
      <strong style="color:#e7e4ed;">${totalNeedsReview} von ${totalActive}</strong> aktiven Objekten
      (${pct.toFixed(1)}%) sind aktuell mit <code>needs_review</code> markiert. ${trendHtml}
    </p>
    <h2 style="margin:0 0 8px 0;font-size:14px;color:#c4b5fd;">Nach Quelle</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#221e2c;border-radius:10px;overflow:hidden;">
      ${bySourceRows || `<tr><td style="padding:10px 12px;color:#a9a4b6;">Keine Auffälligkeiten.</td></tr>`}
    </table>
    <h2 style="margin:0 0 8px 0;font-size:14px;color:#c4b5fd;">Häufigste Probleme</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;background:#221e2c;border-radius:10px;overflow:hidden;">
      ${reasonRows || `<tr><td style="padding:10px 12px;color:#a9a4b6;">Keine Auffälligkeiten.</td></tr>`}
    </table>
    ${isSafePublicHttpsUrl(dashboardUrl) ? `<a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#8b5cf6;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Details ansehen →</a>` : ""}
  `;

  const html = renderEmailShell({
    title: `Datenqualitäts-Report: ${totalNeedsReview}/${totalActive} auffällig`,
    preheader: `${totalNeedsReview} von ${totalActive} aktiven Objekten mit needs_review`,
    bodyHtml,
  });

  return sendMail({
    to,
    subject: `[Gavel] Datenqualität: ${totalNeedsReview}/${totalActive} Objekte mit needs_review`,
    html,
  });
}

export interface DataFreshnessAlertParams {
  to: string;
  aktiveObjekte: number;
  letzterSchreibzeitpunkt: string | null;
  alterMinuten: number | null;
  schwelleStunden: number;
}

/**
 * Betriebsalarm "Bestand wird nicht mehr aktualisiert" (2026-08-17, siehe
 * scrapers/check_freshness.sh + docs/DATA_QUALITY.md, Abschnitt 10). Nutzt
 * bewusst dieselbe SMTP-Infrastruktur wie Alert- und Datenqualitäts-Mail;
 * neu ist nur der Anlass, nicht der Versandweg.
 */
export async function sendDataFreshnessAlertEmail(params: DataFreshnessAlertParams) {
  const { to, aktiveObjekte, letzterSchreibzeitpunkt, alterMinuten, schwelleStunden } = params;

  const bestandLeer = aktiveObjekte === 0 || alterMinuten == null;
  const stunden = alterMinuten != null ? Math.floor(alterMinuten / 60) : null;

  const subject = bestandLeer
    ? "[Gavel] Kein aktives Objekt im Bestand"
    : `[Gavel] Bestand seit ${stunden} Stunden nicht aktualisiert`;

  const lage = bestandLeer
    ? `Im aktiven Bestand liegt derzeit <strong style="color:#e7e4ed;">kein einziges Objekt</strong>
       (${aktiveObjekte} aktiv), ein Zeitpunkt der letzten Aktualisierung existiert deshalb nicht.
       Die Anwendung zeigt in diesem Zustand leere Listen.`
    : `Der jüngste <code>last_seen_at</code> im aktiven Bestand ist vom
       <strong style="color:#e7e4ed;">${escapeHtml(letzterSchreibzeitpunkt ?? "")}</strong>
       und damit <strong style="color:#e7e4ed;">${stunden} Stunden</strong> alt
       (Schwelle: ${schwelleStunden} Stunden). Aktiv sind ${aktiveObjekte} Objekte.`;

  const bodyHtml = `
    <h1 style="margin:0 0 4px 0;font-size:19px;color:#f2f0f6;">Bestand wird nicht mehr aktualisiert</h1>
    <p style="margin:0 0 16px 0;color:#a9a4b6;">${lage}</p>
    <p style="margin:0 0 8px 0;color:#a9a4b6;">
      Erster Prüfschritt: die Prefect-Läufe der drei Scrape-Flows des letzten Tages ansehen. Ein Lauf,
      der grün gemeldet hat, ohne etwas zu speichern, ist der wahrscheinlichste Fall (Vorfall vom
      14.08.2026, siehe <code>docs/DATA_QUALITY.md</code>). Danach
      <code>scrapers/archive_expired.sh --dry-run</code> ausführen: das ändert nichts und zeigt,
      wie viele Objekte die Archivierung gerade deaktivieren würde.
    </p>
  `;

  const html = renderEmailShell({
    title: subject,
    preheader: bestandLeer
      ? "Kein aktives Objekt im Bestand"
      : `Jüngster last_seen_at ist ${stunden} Stunden alt`,
    bodyHtml,
  });

  return sendMail({ to, subject, html });
}

export async function sendEmailChangeConfirmEmail(params: {
  to: string;
  userName: string;
  confirmUrl: string;
  expiresHours?: number;
}) {
  const hours = params.expiresHours ?? 24;
  const bodyHtml = `
    <h1 style="margin:0 0 4px 0;font-size:19px;color:#f2f0f6;">E-Mail-Adresse bestätigen</h1>
    <p style="margin:0 0 16px 0;color:#a9a4b6;">
      Hallo ${escapeHtml(params.userName)}, bitte bestätige die neue Adresse
      <strong style="color:#e7e4ed;">${escapeHtml(params.to)}</strong> für dein Gavel-Konto.
      Der Link ist ${hours} Stunden gültig.
    </p>
    ${
      isSafeEmailConfirmUrl(params.confirmUrl)
        ? `<p style="margin:0 0 16px 0;">
      <a href="${escapeHtml(params.confirmUrl)}"
         style="display:inline-block;padding:10px 18px;background:#8b5cf6;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
        E-Mail bestätigen →
      </a>
    </p>`
        : ""
    }
    <p style="margin:0;color:#8a8496;font-size:12px;">
      Wenn du das nicht warst, ignoriere diese Nachricht. Die bisherige Adresse bleibt aktiv.
    </p>
  `;
  const html = renderEmailShell({
    title: "E-Mail-Adresse bestätigen",
    preheader: "Bitte die neue Gavel-Adresse bestätigen",
    bodyHtml,
  });
  return sendMail({
    to: params.to,
    subject: "[Gavel] Neue E-Mail-Adresse bestätigen",
    html,
  });
}

export async function sendEmailChangeNoticeEmail(params: {
  to: string;
  userName: string;
  newEmail: string;
}) {
  const bodyHtml = `
    <h1 style="margin:0 0 4px 0;font-size:19px;color:#f2f0f6;">Änderung der E-Mail-Adresse</h1>
    <p style="margin:0 0 16px 0;color:#a9a4b6;">
      Hallo ${escapeHtml(params.userName)}, für dein Gavel-Konto wurde eine Änderung auf
      <strong style="color:#e7e4ed;">${escapeHtml(params.newEmail)}</strong> angefordert.
      Die bisherige Adresse bleibt aktiv, bis die neue bestätigt ist.
    </p>
    <p style="margin:0;color:#8a8496;font-size:12px;">
      Wenn du das nicht warst, ändere dein Passwort und prüfe die aktiven Sitzungen.
    </p>
  `;
  const html = renderEmailShell({
    title: "Änderung der E-Mail-Adresse",
    preheader: "Für dein Konto wurde eine neue E-Mail-Adresse angefordert",
    bodyHtml,
  });
  return sendMail({
    to: params.to,
    subject: "[Gavel] Änderung der E-Mail-Adresse angefordert",
    html,
  });
}

export async function sendOpsAlertEmail(params: { to: string; title: string; body: string }) {
  const html = renderEmailShell({
    title: params.title,
    preheader: params.title,
    bodyHtml: `<p style="margin:0;color:#a9a4b6;white-space:pre-wrap;">${escapeHtml(params.body)}</p>`,
  });
  return sendMail({
    to: params.to,
    subject: `[Gavel] ${params.title}`,
    html,
  });
}

export async function sendAlertEmail(params: SendAlertEmailParams) {
  const baseUrl = siteUrl();

  const listingsHtml = params.listings
    .map((l) => {
      const termin = formatDate(l.terminDate);
      const imageSrc = publicAlertImageUrl(l.imageUrl, baseUrl);
      const imageCell = imageSrc
        ? `<td width="120" valign="top" style="padding-right:16px;">
             <img src="${escapeHtml(imageSrc)}" width="120" height="90" alt=""
                  style="display:block;width:120px;height:90px;object-fit:cover;border-radius:10px;background:#2c2735;" />
           </td>`
        : "";
      const listingPath = zvgListingPath(l.bundesland, l.slug);
      const listingHref = listingPath ? `${baseUrl}${listingPath}` : baseUrl;

      return `
      <tr>
        <td style="padding:0 0 18px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#221e2c;border:1px solid #322c3c;border-radius:12px;padding:16px;">
            <tr>
              ${imageCell}
              <td valign="top">
                <div style="font-size:15px;font-weight:600;color:#f2f0f6;margin-bottom:4px;">
                  ${escapeHtml(l.typ ?? "Objekt")}
                </div>
                <div style="font-size:13px;color:#a9a4b6;margin-bottom:8px;">
                  ${escapeHtml(l.adresse ?? "–")}
                  ${l.amtsgericht ? ` &middot; AG ${escapeHtml(l.amtsgericht)}` : ""}
                  ${termin ? ` &middot; Termin ${termin}` : ""}
                </div>
                <div style="font-size:15px;font-weight:700;color:#c4b5fd;margin-bottom:12px;">
                  ${l.verkehrswert != null && Number.isFinite(l.verkehrswert) ? formatEur(l.verkehrswert) : "Verkehrswert nicht bekannt"}
                </div>
                <a href="${listingHref}"
                   style="display:inline-block;padding:8px 16px;background:#8b5cf6;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
                  Zum Objekt →
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join("");

  const bodyHtml = `
    <h1 style="margin:0 0 4px 0;font-size:19px;color:#f2f0f6;">Neue Treffer für „${escapeHtml(params.alertName)}"</h1>
    <p style="margin:0 0 20px 0;color:#a9a4b6;">
      Hallo ${escapeHtml(params.userName)}, wir haben
      <strong style="color:#e7e4ed;">${params.listings.length} neue passende Objekt${params.listings.length === 1 ? "" : "e"}</strong>
      für deinen Alert gefunden:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${listingsHtml}
    </table>
  `;

  const html = renderEmailShell({
    title: `${params.listings.length} neue Objekte für „${params.alertName}"`,
    preheader: `${params.listings.length} neue Treffer für deinen Alert „${params.alertName}"`,
    bodyHtml,
  });

  return sendMail({
    to: params.to,
    subject: `[Gavel] ${params.listings.length} neue Objekte für „${params.alertName}"`,
    html,
  });
}
