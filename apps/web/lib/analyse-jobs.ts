import { MANUAL_UPLOAD_HOST } from "@/lib/listing-privacy";
import { listingSourceUrlKey, stripSensitiveUrlQuery } from "@/lib/safe-url";
import { DISPLAY_TIME_ZONE, isValidUuid } from "@/lib/utils";

export { MANUAL_UPLOAD_HOST };

export type AnalyseJobStatus = "queued" | "running" | "success" | "error";

export type AnalyseJobStep =
  "queued" | "fetching" | "extracting" | "market" | "investment" | "images" | "done" | "failed";

export type AnalyseLogKind = "line" | "chapter" | "teaser" | "verdict";

export interface AnalyseLogEntry {
  t?: string;
  msg: string;
  hb?: boolean;
  phase?: string;
  kind?: AnalyseLogKind;
}

export interface AnalysePreview {
  typ?: string | null;
  preis?: number | null;
  zimmer?: number | null;
  flaecheM2?: number | null;
  preisProM2?: number | null;
  ort?: string | null;
  bildCount?: number | null;
  preisBewertung?: string | null;
  angebotstyp?: "kauf" | "miete" | null;
  /** attraktiv | neutral | abraten */
  investmentScore?: string | null;
}

export interface AnalyseJob {
  id: string;
  url: string;
  status: AnalyseJobStatus;
  step: AnalyseJobStep | string | null;
  progressPct: number | null;
  stepDetail: string | null;
  stepLog: AnalyseLogEntry[];
  preview: AnalysePreview | null;
  listingId: string | null;
  errorMessage: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
}

export function normalizeStepLog(raw: unknown): AnalyseLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AnalyseLogEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) {
      const msg = publicJobErrorMessage(item);
      if (msg) out.push({ msg, kind: "line" });
      continue;
    }
    if (item && typeof item === "object" && "msg" in item) {
      const o = item as Record<string, unknown>;
      const msg = publicJobErrorMessage(String(o.msg ?? ""));
      if (!msg) continue;
      const kindRaw = typeof o.kind === "string" ? o.kind : "line";
      const kind: AnalyseLogKind =
        kindRaw === "chapter" || kindRaw === "teaser" || kindRaw === "verdict" ? kindRaw : "line";
      out.push({
        msg,
        t: typeof o.t === "string" ? o.t : undefined,
        hb: o.hb === true,
        phase: typeof o.phase === "string" ? o.phase : undefined,
        kind,
      });
    }
  }
  return out;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asInvestmentScore(v: unknown): string | null {
  if (v === "attraktiv" || v === "neutral" || v === "abraten") return v;
  return null;
}

export function normalizePreview(raw: unknown): AnalysePreview | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    typ: typeof o.typ === "string" ? o.typ : null,
    preis: asNumber(o.preis),
    zimmer: asNumber(o.zimmer),
    flaecheM2: asNumber(o.flaecheM2),
    preisProM2: asNumber(o.preisProM2),
    ort: typeof o.ort === "string" ? o.ort : null,
    angebotstyp: o.angebotstyp === "kauf" || o.angebotstyp === "miete" ? o.angebotstyp : null,
    bildCount: asNumber(o.bildCount),
    preisBewertung: typeof o.preisBewertung === "string" ? o.preisBewertung : null,
    investmentScore: asInvestmentScore(o.investmentScore),
  };
}

export function formatLogTime(iso?: string): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("de-DE", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export const ASSEMBLY_STEPS: {
  key: AnalyseJobStep;
  label: string;
  part: string;
}[] = [
  { key: "fetching", label: "FETCH", part: "Rohdaten" },
  { key: "extracting", label: "EXTRACT", part: "Fakten" },
  { key: "market", label: "MARKET", part: "Score" },
  { key: "investment", label: "DEAL", part: "Deal" },
  { key: "images", label: "IMAGES", part: "Galerie" },
];

const STEP_ORDER: AnalyseJobStep[] = [
  "queued",
  "fetching",
  "extracting",
  "market",
  "investment",
  "images",
  "done",
  "failed",
];

export function stepIndex(step: string | null | undefined): number {
  if (!step) return 0;
  const i = STEP_ORDER.indexOf(step as AnalyseJobStep);
  return i < 0 ? 0 : i;
}

export function stepLabel(step: string | null | undefined): string {
  if (!step) return "QUEUED";
  if (step === "queued" || step === "accepted") return "QUEUED";
  if (step === "done") return "DONE";
  if (step === "failed" || step === "error") return "FAIL";
  const found = ASSEMBLY_STEPS.find((s) => s.key === step);
  return found?.label ?? step.toUpperCase();
}

export const STALE_ANALYSE_JOB_MINUTES = 45;
export const ACCEPTED_STALE_ANALYSE_JOB_MINUTES = 15;

export function canFailAnalyseJobAfterHandoff(
  status: string,
  step: string | null | undefined,
): boolean {
  if (status === "queued") return true;
  return status === "running" && (!step || step === "queued" || step === "accepted");
}

export function shouldAcceptAnalyseJobAfterStartFailure(jobWasAborted: boolean): boolean {
  return !jobWasAborted;
}

export function isAnalyseJobHandoffTerminal(status: string | null | undefined): boolean {
  return status === "error";
}

export function shouldReapAcceptedAnalyseJob(job: {
  listingId?: string | null;
  step?: string | null;
}): boolean {
  return job.step === "accepted" && !job.listingId;
}

export function analyseDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.ANALYSE_DAILY_LIMIT ?? "25");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 25;
}

export function isManualUploadUrl(url: string): boolean {
  return url.includes(`//${MANUAL_UPLOAD_HOST}/`);
}

export function analyseJobStorageUrl(input: {
  hasHtml?: boolean;
  hasPdf?: boolean;
  referenceUrl?: string | null;
}): string {
  if (input.hasPdf) return `https://${MANUAL_UPLOAD_HOST}/pdf/pending`;
  if (input.hasHtml) return `https://${MANUAL_UPLOAD_HOST}/html/pending`;
  return input.referenceUrl ?? "";
}

export function analyseListingUrlCandidates(url: string): string[] {
  const keys = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    keys.add(trimmed);
    keys.add(listingSourceUrlKey(trimmed));
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname;
      if (host.startsWith("www.")) {
        parsed.hostname = host.slice(4);
        keys.add(parsed.toString());
        keys.add(listingSourceUrlKey(parsed.toString()));
      } else if (host) {
        parsed.hostname = `www.${host}`;
        keys.add(parsed.toString());
      }
    } catch {
      /* ignore */
    }
    try {
      const parsed = new URL(listingSourceUrlKey(trimmed));
      const path = parsed.pathname.toLowerCase();
      if (path.includes("/expose/") || path.includes("/s-anzeige/")) {
        parsed.search = "";
      }
      keys.add(parsed.toString());
      const host = parsed.hostname;
      if (host.startsWith("www.")) {
        parsed.hostname = host.slice(4);
        keys.add(parsed.toString());
      } else if (host) {
        parsed.hostname = `www.${host}`;
        keys.add(parsed.toString());
      }
    } catch {
      /* ignore */
    }
  };
  add(url);
  return [...keys];
}

export function analyseJobLooksPrivate(job: {
  url: string;
  stepDetail?: string | null;
  stepLog?: Array<{ msg?: string } | string> | null;
}): boolean {
  if (isManualUploadUrl(job.url)) return true;
  const parts = [job.stepDetail ?? ""];
  for (const entry of job.stepLog ?? []) {
    if (typeof entry === "string") parts.push(entry);
    else if (entry?.msg) parts.push(entry.msg);
  }
  return /sitzung|html-inhalt|pdf wird gelesen/i.test(parts.join("\n"));
}

export function analyseJobTargetsListing(input: {
  jobListingId: string | null | undefined;
  jobUrl: string;
  jobLooksPrivate: boolean;
  listingId: string;
  listingSourceUrl: string | null | undefined;
  listingIsPrivate: boolean;
}): boolean {
  if (input.jobListingId && input.jobListingId === input.listingId) return true;
  const listingUrl = input.listingSourceUrl ?? "";
  const jobKeys = new Set(analyseListingUrlCandidates(input.jobUrl));
  const listingKeys = new Set(analyseListingUrlCandidates(listingUrl));
  const urlOverlap = [...jobKeys].some((key) => listingKeys.has(key));
  if (urlOverlap) return input.listingIsPrivate === input.jobLooksPrivate;
  return (
    input.listingIsPrivate &&
    isManualUploadUrl(listingUrl) &&
    isManualUploadUrl(input.jobUrl) &&
    input.jobLooksPrivate
  );
}

export function jobDomain(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === MANUAL_UPLOAD_HOST) {
      return parsed.pathname.startsWith("/pdf/") ? "PDF-Upload" : "HTML-Einfügung";
    }
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "custom";
  }
}

export function isJobActive(job: Pick<AnalyseJob, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}

export function publicAnalyseJobListingId(
  listingId: string | null | undefined,
  visibleListingIds: ReadonlySet<string>,
): string | null {
  if (!listingId || !visibleListingIds.has(listingId)) return null;
  return listingId;
}

export function serializeAnalyseJob(
  row: {
    id: string;
    url: string;
    status: string;
    step: string | null;
    progressPct: number | null;
    stepDetail: string | null;
    stepLog: unknown;
    preview: unknown;
    listingId: string | null;
    errorMessage: string | null;
    requestedAt: Date | null;
    updatedAt: Date | null;
  },
  visibleListingIds: ReadonlySet<string>,
): AnalyseJob {
  return {
    id: row.id,
    url: stripSensitiveUrlQuery(row.url),
    status: row.status as AnalyseJobStatus,
    step: row.step,
    progressPct: row.progressPct,
    stepDetail: publicJobErrorMessage(row.stepDetail),
    stepLog: normalizeStepLog(row.stepLog),
    preview: normalizePreview(row.preview),
    listingId: publicAnalyseJobListingId(row.listingId, visibleListingIds),
    errorMessage: publicJobErrorMessage(row.errorMessage),
    requestedAt: row.requestedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

const INTERNAL_JOB_ERROR =
  /Traceback|File "|Exception:|httpx\.|ssl\.|socket\.|ConnectError|TimeoutError|OperationalError|ECONNREFUSED|Errno |net::ERR_|ERR_CONNECTION|SCRAPER_API_SECRET|serverseitig nicht konfiguriert|^Unauthorized$|\b(?:postgres|redis|minio|localhost)(?::\d+)?\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\.(?:internal|local|svc|cluster\.local)\b/i;

export function publicJobErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (INTERNAL_JOB_ERROR.test(trimmed)) {
    return "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.";
  }
  return trimmed;
}

export function publicAnalyseStartStatus(scraperStatus: number): number {
  if (scraperStatus === 429) return 429;
  if (scraperStatus === 400 || scraperStatus === 422) return 400;
  return 502;
}

function analyseJobText(job: Pick<AnalyseJob, "stepLog" | "errorMessage" | "stepDetail">): string {
  return [job.errorMessage, job.stepDetail, ...(job.stepLog ?? []).map((entry) => entry.msg)]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();
}

export function jobUsedSessionCookie(
  job: Pick<AnalyseJob, "stepLog" | "errorMessage" | "stepDetail">,
): boolean {
  const text = analyseJobText(job);
  return (
    text.includes("eingefügten cookie") ||
    text.includes("eingefügte sitzung") ||
    text.includes("cookie_session")
  );
}

export function jobUsedManualContent(
  job: Pick<AnalyseJob, "stepLog" | "errorMessage" | "stepDetail">,
): boolean {
  const text = analyseJobText(job);
  return (
    text.includes("html-inhalt") ||
    text.includes("pdf wird gelesen") ||
    text.includes("aus dem pdf extrahiert") ||
    text.includes("das pdf enthält keinen")
  );
}

export function canRetryAnalyseJob(
  job: Pick<AnalyseJob, "url" | "stepLog" | "errorMessage" | "stepDetail">,
): boolean {
  return !isManualUploadUrl(job.url) && !jobUsedSessionCookie(job) && !jobUsedManualContent(job);
}

const ANALYSE_JOB_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "success",
  "error",
]);

export function isAnalyseJobPayload(value: unknown): value is AnalyseJob {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    row.id.length === 0 ||
    typeof row.status !== "string" ||
    !ANALYSE_JOB_STATUSES.has(row.status)
  ) {
    return false;
  }
  if (row.listingId == null) return true;
  return typeof row.listingId === "string" && isValidUuid(row.listingId);
}

const STORAGE_KEY = "gavel.analyse.jobIds";

export function loadJobIdsFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveJobIdsToStorage(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota */
  }
}
