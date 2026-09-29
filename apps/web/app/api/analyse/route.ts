import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { findExistingAnalyseTargetListing, resolveAnalyseTargetUrl } from "@/lib/analyse-access";
import {
  AnalyseDailyQuotaExceeded,
  failQueuedAnalyseJob,
  MAX_ACTIVE_JOBS_PER_USER,
  reapStaleAnalyseJobsForUser,
  tryCreateAnalyseJob,
} from "@/lib/analyse-job-create";
import {
  analyseDailyLimit,
  analyseJobStorageUrl,
  publicAnalyseStartStatus,
  publicJobErrorMessage,
  shouldAcceptAnalyseJobAfterStartFailure,
} from "@/lib/analyse-jobs";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import {
  declaredContentLengthExceeds,
  maxAnalyseRequestBodyBytes,
  parseJsonObject,
  readTextCapped,
} from "@/lib/request-body";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { decodeManualPdfBase64, MAX_MANUAL_PDF_BASE64_CHARS } from "@/lib/manual-pdf";
import { isUsableCookieHeader, normalizeCookieHeader, validateAnalyseUrl } from "@/lib/safe-url";

const ANALYSE_BURST = { max: 5, windowSeconds: 60, failClosed: true };

/**
 * Startet eine asynchrone Custom-URL-Analyse (Background-Job im Scraper).
 * Antwortet sofort mit 202 + jobId; Fortschritt via GET /api/analyse/jobs/[id].
 *
 * Phase 3 (private/login-geschützte Angebote, siehe docs/CUSTOM_URL_ANALYSIS.md):
 * neben der Live-URL werden zwei weitere Content-Quellen unterstützt -
 * eingefügter HTML-Quelltext ODER ein PDF-Upload (Base64) - sowie optional
 * ein vom Nutzer EXPLIZIT eingefügter Session-Cookie für den Live-Fetch.
 * Genau eine der drei Quellen (url/html/pdfBase64) ist maßgeblich; die
 * eigentliche Validierung (Größe, SSRF, Formate) läuft zusätzlich
 * serverseitig im Scraper.
 */

const MAX_MANUAL_HTML_CHARS = 1_500_000;
const MIN_MANUAL_HTML_CHARS = 100;
const MAX_COOKIE_HEADER_CHARS = 8000;
const MAX_ANALYSE_BODY_BYTES = maxAnalyseRequestBodyBytes();

interface AnalyseRequestBody {
  url?: unknown;
  html?: unknown;
  pdfBase64?: unknown;
  cookieHeader?: unknown;
}

export async function POST(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const burstKey = `analyse:${session.user.id}`;
  if (await isRateLimited(burstKey, ANALYSE_BURST)) {
    return NextResponse.json(
      { error: "Zu viele Analyse-Anfragen. Bitte kurz warten." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(burstKey, ANALYSE_BURST);

  if (declaredContentLengthExceeds(req.headers.get("content-length"), MAX_ANALYSE_BODY_BYTES)) {
    return NextResponse.json({ error: "Anfrage ist zu groß" }, { status: 413 });
  }
  const rawBody = await readTextCapped(req.body, MAX_ANALYSE_BODY_BYTES);
  if (!rawBody.ok) {
    return NextResponse.json({ error: "Anfrage ist zu groß" }, { status: 413 });
  }
  const body = parseJsonObject(rawBody.text) as AnalyseRequestBody;
  const hasHtml = typeof body.html === "string" && body.html.trim().length > 0;
  const hasPdf = typeof body.pdfBase64 === "string" && body.pdfBase64.trim().length > 0;

  if (hasHtml && hasPdf) {
    return NextResponse.json(
      { error: "Bitte nur einen Inhalt einreichen (HTML-Einfügung ODER PDF-Upload)" },
      { status: 400 },
    );
  }

  let referenceUrl: string | undefined;
  if (typeof body.url === "string" && body.url.trim()) {
    const validated = validateAnalyseUrl(body.url);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    referenceUrl = validated.url;
  }

  let cookieHeader: string | undefined;
  if (typeof body.cookieHeader === "string" && body.cookieHeader.trim()) {
    if (hasHtml || hasPdf) {
      return NextResponse.json(
        { error: "Der Sitzungs-Cookie ist nur beim Live-Abruf per URL nutzbar" },
        { status: 400 },
      );
    }
    const normalizedCookie = normalizeCookieHeader(body.cookieHeader);
    if (!isUsableCookieHeader(normalizedCookie)) {
      return NextResponse.json({ error: "Cookie-Wert ist ungültig" }, { status: 400 });
    }
    if (normalizedCookie.length > MAX_COOKIE_HEADER_CHARS) {
      return NextResponse.json({ error: "Cookie-Wert ist zu lang" }, { status: 400 });
    }
    if (!referenceUrl) {
      return NextResponse.json(
        { error: "Für den Sitzungs-Cookie wird die Angebots-URL benötigt" },
        { status: 400 },
      );
    }
    cookieHeader = normalizedCookie;
  }

  if (hasHtml && (body.html as string).length > MAX_MANUAL_HTML_CHARS) {
    return NextResponse.json(
      {
        error: `HTML-Inhalt ist zu groß (Limit ${MAX_MANUAL_HTML_CHARS.toLocaleString("de-DE")} Zeichen)`,
      },
      { status: 400 },
    );
  }
  if (hasHtml) {
    const html = (body.html as string).trim();
    if (html.length < MIN_MANUAL_HTML_CHARS || !html.includes("<")) {
      return NextResponse.json(
        { error: "HTML-Inhalt ist zu kurz oder kein gültiges HTML" },
        { status: 400 },
      );
    }
  }
  if (hasPdf && (body.pdfBase64 as string).length > MAX_MANUAL_PDF_BASE64_CHARS) {
    return NextResponse.json({ error: "PDF-Datei ist zu groß (Limit 15 MB)" }, { status: 400 });
  }
  if (hasPdf) {
    const pdf = decodeManualPdfBase64(body.pdfBase64 as string);
    if (!pdf.ok) {
      return NextResponse.json({ error: pdf.error }, { status: 400 });
    }
  }
  if (!referenceUrl && !hasHtml && !hasPdf) {
    return NextResponse.json({ error: "URL fehlt" }, { status: 400 });
  }

  const scraperApiUrl = process.env.SCRAPER_API_URL;
  const scraperApiSecret = process.env.SCRAPER_API_SECRET;
  if (!scraperApiUrl || !scraperApiSecret) {
    console.error("[POST /api/analyse] SCRAPER_API_URL/SCRAPER_API_SECRET nicht konfiguriert");
    return NextResponse.json({ error: "Analyse-Dienst nicht verfügbar" }, { status: 503 });
  }

  const jobUrl = analyseJobStorageUrl({ hasHtml, hasPdf, referenceUrl });
  const targetUrl = resolveAnalyseTargetUrl({
    hasHtml,
    hasPdf,
    referenceUrl,
    html: hasHtml ? (body.html as string) : null,
    pdfBase64: hasPdf ? (body.pdfBase64 as string) : null,
  });
  const privateFetch = Boolean(cookieHeader) || hasHtml || hasPdf;

  let jobId: string;
  try {
    await reapStaleAnalyseJobsForUser(session.user.id);
    const existingListingId = targetUrl
      ? await findExistingAnalyseTargetListing(session.user.id, targetUrl, privateFetch)
      : null;
    const created = await tryCreateAnalyseJob(
      session.user.id,
      jobUrl,
      analyseDailyLimit(),
      Boolean(cookieHeader),
      existingListingId,
    );
    if (!created.ok) {
      return NextResponse.json(
        {
          error: `Maximal ${MAX_ACTIVE_JOBS_PER_USER} Analysen gleichzeitig. Bitte warten, bis eine fertig ist.`,
        },
        { status: 429 },
      );
    }
    jobId = created.jobId;
  } catch (error) {
    if (error instanceof AnalyseDailyQuotaExceeded) {
      return NextResponse.json(
        {
          error: `Tageslimit von ${error.limit} Analysen erreicht. Bitte morgen erneut versuchen.`,
        },
        { status: 429 },
      );
    }
    console.error("[POST /api/analyse] Job-Anlage", error);
    return NextResponse.json({ error: "Analyse konnte nicht gestartet werden" }, { status: 500 });
  }

  try {
    const res = await fetch(`${scraperApiUrl}/internal/analyze-url-async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${scraperApiSecret}`,
      },
      body: JSON.stringify({
        job_id: jobId,
        url: referenceUrl,
        html: hasHtml ? body.html : undefined,
        pdf_base64: hasPdf ? body.pdfBase64 : undefined,
        cookie_header: cookieHeader,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const aborted = await failQueuedAnalyseJob(jobId, "Analyse konnte nicht gestartet werden");
      if (shouldAcceptAnalyseJobAfterStartFailure(aborted)) {
        return NextResponse.json({ jobId }, { status: 202 });
      }
      const rawDetail = typeof data?.detail === "string" ? data.detail : null;
      return NextResponse.json(
        {
          error: publicJobErrorMessage(rawDetail) ?? "Analyse konnte nicht gestartet werden",
        },
        { status: publicAnalyseStartStatus(res.status) },
      );
    }

    if (!data.ok) {
      const aborted = await failQueuedAnalyseJob(jobId, "Analyse konnte nicht gestartet werden");
      if (shouldAcceptAnalyseJobAfterStartFailure(aborted)) {
        return NextResponse.json({ jobId }, { status: 202 });
      }
      return NextResponse.json(
        {
          error:
            publicJobErrorMessage(typeof data.error === "string" ? data.error : null) ??
            "Analyse konnte nicht gestartet werden",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    console.error("[POST /api/analyse]", error);
    const aborted = await failQueuedAnalyseJob(jobId, "Der Analyse-Dienst antwortet nicht.");
    if (shouldAcceptAnalyseJobAfterStartFailure(aborted)) {
      return NextResponse.json({ jobId }, { status: 202 });
    }
    return NextResponse.json(
      { error: "Der Analyse-Dienst antwortet nicht (Timeout oder nicht erreichbar)." },
      { status: 502 },
    );
  }
}
