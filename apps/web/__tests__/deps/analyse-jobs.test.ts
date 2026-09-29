import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_STALE_ANALYSE_JOB_MINUTES,
  analyseDailyLimit,
  analyseJobLooksPrivate,
  analyseJobStorageUrl,
  analyseJobTargetsListing,
  analyseListingUrlCandidates,
  canFailAnalyseJobAfterHandoff,
  canRetryAnalyseJob,
  normalizePreview,
  normalizeStepLog,
  publicAnalyseStartStatus,
  publicJobErrorMessage,
  isAnalyseJobHandoffTerminal,
  isAnalyseJobPayload,
  publicAnalyseJobListingId,
  serializeAnalyseJob,
  shouldAcceptAnalyseJobAfterStartFailure,
  shouldReapAcceptedAnalyseJob,
  STALE_ANALYSE_JOB_MINUTES,
  stepLabel,
  formatLogTime,
} from "@/lib/analyse-jobs";

describe("analyseDailyLimit", () => {
  it("nimmt gültige Limits und fällt sonst auf 25 zurück", () => {
    expect(analyseDailyLimit({ ANALYSE_DAILY_LIMIT: "10" })).toBe(10);
    expect(analyseDailyLimit({ ANALYSE_DAILY_LIMIT: "1.9" })).toBe(1);
    expect(analyseDailyLimit({})).toBe(25);
    expect(analyseDailyLimit({ ANALYSE_DAILY_LIMIT: "0" })).toBe(25);
    expect(analyseDailyLimit({ ANALYSE_DAILY_LIMIT: "nope" })).toBe(25);
  });
});

describe("publicJobErrorMessage", () => {
  it("lässt nutzerlesbare Texte durch", () => {
    expect(publicJobErrorMessage("Die Seite konnte nicht geladen werden.")).toBe(
      "Die Seite konnte nicht geladen werden.",
    );
    expect(publicJobErrorMessage(null)).toBeNull();
  });

  it("ersetzt Exception- und Traceback-Leaks", () => {
    expect(publicJobErrorMessage("Analyse fehlgeschlagen: httpx.ConnectError: [Errno 111]")).toBe(
      "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
    );
    expect(publicJobErrorMessage('Traceback (most recent call last):\n  File "app.py"')).toBe(
      "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
    );
    expect(publicJobErrorMessage("Analyse fehlgeschlagen: ConnectError postgres:5432")).toBe(
      "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
    );
    expect(publicJobErrorMessage("timeout talking to redis.internal")).toBe(
      "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
    );
    expect(publicJobErrorMessage("SCRAPER_API_SECRET ist serverseitig nicht konfiguriert")).toBe(
      "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
    );
    expect(
      publicJobErrorMessage("Seite konnte nicht geladen werden: net::ERR_CONNECTION_REFUSED"),
    ).toBe("Bei der Analyse ist ein unerwarteter Fehler aufgetreten.");
    expect(publicJobErrorMessage("connect to 10.0.0.5:443 failed")).toBe(
      "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
    );
  });
});

describe("publicAnalyseStartStatus", () => {
  it("mappt interne Scraper-Status auf wenige Client-Codes", () => {
    expect(publicAnalyseStartStatus(429)).toBe(429);
    expect(publicAnalyseStartStatus(422)).toBe(400);
    expect(publicAnalyseStartStatus(401)).toBe(502);
    expect(publicAnalyseStartStatus(500)).toBe(502);
  });
});

describe("canFailAnalyseJobAfterHandoff", () => {
  it("bricht nur queued oder gerade übernommene Jobs ab", () => {
    expect(canFailAnalyseJobAfterHandoff("queued", "queued")).toBe(true);
    expect(canFailAnalyseJobAfterHandoff("running", "accepted")).toBe(true);
    expect(canFailAnalyseJobAfterHandoff("running", null)).toBe(true);
    expect(canFailAnalyseJobAfterHandoff("running", "fetching")).toBe(false);
    expect(canFailAnalyseJobAfterHandoff("success", "done")).toBe(false);
    expect(stepLabel("accepted")).toBe("QUEUED");
    expect(shouldAcceptAnalyseJobAfterStartFailure(false)).toBe(true);
    expect(shouldAcceptAnalyseJobAfterStartFailure(true)).toBe(false);
    expect(isAnalyseJobHandoffTerminal("error")).toBe(true);
    expect(isAnalyseJobHandoffTerminal("running")).toBe(false);
    expect(isAnalyseJobHandoffTerminal("success")).toBe(false);
    const createSql = readFileSync(path.join(__dirname, "../../lib/analyse-job-create.ts"), "utf8");
    expect(createSql).toContain("returning({ id: customUrlRequests.id })");
    expect(createSql).toContain("publicJobErrorMessage(message)");
    expect(createSql).toContain("ANALYSE_HISTORY_KEEP_SUCCESS");
    expect(createSql).toContain("ANALYSE_ERROR_RETENTION_DAYS");
    expect(createSql).toContain("DELETE FROM custom_url_requests");
    expect(createSql).toContain("SELECT DISTINCT ON (listing_id) id");
    expect(createSql).toContain("listing_id IS NULL");
    expect(createSql).toContain("usedSessionCookie");
    expect(createSql).toContain("Analyse vorbereitet · eingefügte Sitzung");
    expect(createSql).toContain("failQueuedAnalyseJob");
    expect(createSql).not.toMatch(/failQueuedAnalyseJob[\s\S]*stepLog\s*:/);
    const routeSql = readFileSync(path.join(__dirname, "../../app/api/analyse/route.ts"), "utf8");
    expect(routeSql).toContain("shouldAcceptAnalyseJobAfterStartFailure");
    expect(routeSql).toContain("readTextCapped");
    expect(routeSql).toContain("declaredContentLengthExceeds");
    const burstAt = routeSql.indexOf("recordRateLimitHit(burstKey");
    const createAt = routeSql.indexOf("await tryCreateAnalyseJob(");
    const bodyAt = routeSql.indexOf("const rawBody = await readTextCapped");
    expect(burstAt).toBeGreaterThan(0);
    expect(createAt).toBeGreaterThan(burstAt);
    expect(bodyAt).toBeGreaterThan(burstAt);
    expect(routeSql).toContain("analyseJobStorageUrl");
    expect(routeSql).toContain("findExistingAnalyseTargetListing");
    expect(routeSql).toContain("resolveAnalyseTargetUrl");
    expect(routeSql).toContain("url: referenceUrl");
    expect(routeSql).toContain("Boolean(cookieHeader)");
    expect(routeSql).toContain("existingListingId");
    const createSrc = readFileSync(path.join(__dirname, "../../lib/analyse-job-create.ts"), "utf8");
    expect(createSrc).toContain("listingId?: string | null");
    expect(createSrc).toContain("listing-delete:");
    expect(createSrc).toContain("listingId: boundListingId");
    const terminal = readFileSync(
      path.join(__dirname, "../../components/analyse/analyse-terminal.tsx"),
      "utf8",
    );
    expect(terminal).toContain("canRetryAnalyseJob(job)");
    const client = readFileSync(
      path.join(__dirname, "../../app/analyse/(uebersicht)/client.tsx"),
      "utf8",
    );
    expect(client).toContain("if (isManualUploadUrl(retryUrl)) return");
  });
});

describe("analyseJobStorageUrl", () => {
  it("hängt HTML und PDF nicht an die optionale Portal-URL", () => {
    expect(
      analyseJobStorageUrl({
        hasHtml: true,
        referenceUrl: "https://www.immowelt.de/expose/1",
      }),
    ).toBe("https://manuelle-eingabe.immopulse/html/pending");
    expect(
      analyseJobStorageUrl({
        hasPdf: true,
        referenceUrl: "https://www.immowelt.de/expose/1",
      }),
    ).toBe("https://manuelle-eingabe.immopulse/pdf/pending");
    expect(analyseJobStorageUrl({ referenceUrl: "https://www.immowelt.de/expose/1" })).toBe(
      "https://www.immowelt.de/expose/1",
    );
  });
});

describe("canRetryAnalyseJob", () => {
  const live = {
    url: "https://www.immowelt.de/expose/1",
    stepLog: [] as { msg: string }[],
    errorMessage: null as string | null,
    stepDetail: null as string | null,
  };

  it("erlaubt Retry nur für echte Live-Jobs ohne Cookie", () => {
    expect(canRetryAnalyseJob(live)).toBe(true);
    expect(
      canRetryAnalyseJob({
        ...live,
        url: "https://manuelle-eingabe.immopulse/html/pending",
      }),
    ).toBe(false);
    expect(
      canRetryAnalyseJob({
        ...live,
        stepLog: [{ msg: "Eingefügte Sitzung wird verwendet (nicht gespeichert)" }],
      }),
    ).toBe(false);
    expect(
      canRetryAnalyseJob({
        ...live,
        stepDetail: "Analyse vorbereitet · eingefügte Sitzung",
      }),
    ).toBe(false);
    expect(
      canRetryAnalyseJob({
        ...live,
        stepDetail: "Analyse konnte nicht gestartet werden",
        errorMessage: "Analyse konnte nicht gestartet werden",
        stepLog: [{ msg: "Analyse vorbereitet · eingefügte Sitzung" }],
      }),
    ).toBe(false);
  });

  it("erkennt HTML- und PDF-Jobs auch wenn die Portal-URL gespeichert wurde", () => {
    expect(
      canRetryAnalyseJob({
        ...live,
        stepLog: [{ msg: "Eingefügter HTML-Inhalt wird verarbeitet…" }],
      }),
    ).toBe(false);
    expect(
      canRetryAnalyseJob({
        ...live,
        stepDetail: "PDF wird gelesen…",
      }),
    ).toBe(false);
    expect(
      canRetryAnalyseJob({
        ...live,
        errorMessage:
          "Bitte eine andere URL versuchen oder die Seite über HTML-Einfügung/PDF-Upload analysieren.",
      }),
    ).toBe(true);
  });
});

describe("accepted stale reap", () => {
  it("lässt Accepted-Jobs mit Listing in Ruhe und reap't nur hängende Übernahmen", () => {
    expect(ACCEPTED_STALE_ANALYSE_JOB_MINUTES).toBe(15);
    expect(STALE_ANALYSE_JOB_MINUTES).toBe(45);
    expect(shouldReapAcceptedAnalyseJob({ step: "accepted", listingId: null })).toBe(true);
    expect(shouldReapAcceptedAnalyseJob({ step: "accepted", listingId: "listing-1" })).toBe(false);
    expect(shouldReapAcceptedAnalyseJob({ step: "fetching", listingId: null })).toBe(false);
    const reaperSql = readFileSync(path.join(__dirname, "../../lib/analyse-job-create.ts"), "utf8");
    expect(reaperSql).toContain("listing_id IS NULL");
    expect(reaperSql).toContain("ACCEPTED_STALE_ANALYSE_JOB_MINUTES");
  });
});

describe("isAnalyseJobPayload", () => {
  it("nimmt nur Jobs mit id und bekanntem Status", () => {
    expect(isAnalyseJobPayload({ id: "job-1", status: "running" })).toBe(true);
    expect(isAnalyseJobPayload({ id: "job-1", status: "success" })).toBe(true);
    expect(isAnalyseJobPayload({ id: "", status: "running" })).toBe(false);
    expect(isAnalyseJobPayload({ id: "job-1", status: "nope" })).toBe(false);
    expect(isAnalyseJobPayload({ status: "running" })).toBe(false);
    expect(isAnalyseJobPayload(null)).toBe(false);
    expect(
      isAnalyseJobPayload({
        id: "job-1",
        status: "success",
        listingId: "not-a-uuid",
      }),
    ).toBe(false);
    expect(
      isAnalyseJobPayload({
        id: "job-1",
        status: "success",
        listingId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toBe(true);
  });
});

describe("publicAnalyseJobListingId", () => {
  it("gibt listingId nur bei sichtbarem Listing zurück", () => {
    expect(publicAnalyseJobListingId("listing-1", new Set(["listing-1"]))).toBe("listing-1");
    expect(publicAnalyseJobListingId("listing-1", new Set())).toBeNull();
    expect(publicAnalyseJobListingId(null, new Set(["listing-1"]))).toBeNull();
    const listingId = "550e8400-e29b-41d4-a716-446655440000";
    expect(
      serializeAnalyseJob(
        {
          id: "job-1",
          url: "https://portal.example/expose?token=abc",
          status: "success",
          step: "done",
          progressPct: 100,
          stepDetail: null,
          stepLog: [],
          preview: null,
          listingId,
          errorMessage: null,
          requestedAt: new Date("2026-08-10T12:00:00.000Z"),
          updatedAt: new Date("2026-08-10T12:01:00.000Z"),
        },
        new Set(),
      ).listingId,
    ).toBeNull();
    const jobsRoute = readFileSync(
      path.join(__dirname, "../../app/api/analyse/jobs/route.ts"),
      "utf8",
    );
    const jobRoute = readFileSync(
      path.join(__dirname, "../../app/api/analyse/jobs/[jobId]/route.ts"),
      "utf8",
    );
    expect(jobsRoute).toContain("visibleAnalyseListingIds");
    expect(jobsRoute).toContain("serializeAnalyseJob");
    expect(jobsRoute).toContain("desc(customUrlRequests.requestedAt), desc(customUrlRequests.id)");
    expect(jobsRoute).toContain("desc(customUrlRequests.updatedAt), desc(customUrlRequests.id)");
    expect(jobRoute).toContain("visibleAnalyseListingIds");
    expect(jobRoute).toContain("serializeAnalyseJob");
    expect(jobsRoute).not.toContain("listingId: row.listingId");
    expect(jobRoute).not.toContain("listingId: row.listingId");
  });
});

describe("Analyse-Unlink behält die Tagesquote", () => {
  it("löscht Request-Zeilen nicht und blockt laufende Jobs", () => {
    const access = readFileSync(path.join(__dirname, "../../lib/analyse-access.ts"), "utf8");
    expect(access).toContain('outcome: "busy"');
    expect(access).toContain('inArray(customUrlRequests.status, ["queued", "running"])');
    expect(access).toContain("analyseJobTargetsListing");
    expect(access).toContain("inflightUrlCandidates");
    expect(access).toContain("findExistingAnalyseTargetListing");
    expect(access).toContain(
      "orderBy: [asc(realEstateListings.firstSeenAt), asc(realEstateListings.id)]",
    );
    expect(access).toContain("listingSourceUrlLikePatterns");
    expect(access).toContain("listingSourceUrlKey(url) !== identity");
    expect(access).toContain("LIKE ${pattern} ESCAPE");
    expect(access).toContain("manualAnalyseReferenceUrl");
    expect(access).toContain("resolveAnalyseTargetUrl");
    expect(access).toContain('createHash("sha256")');
    expect(access).toContain("eq(customUrlRequests.userId, userId)");
    expect(access).toContain(".set({ listingId: null })");
    expect(access).not.toContain("delete(customUrlRequests)");
    expect(access).toContain("delete(realEstateListings)");
    const route = readFileSync(
      path.join(__dirname, "../../app/api/analyse/[listingId]/route.ts"),
      "utf8",
    );
    expect(route).toContain('result.outcome === "busy"');
    expect(route).toContain("Analyse läuft noch");
    expect(route).toContain("status: 409");
  });

  it("erkennt Refresh-Jobs ohne listing_id anhand der Quell-URL", () => {
    const listingId = "listing-1";
    const portal = "https://www.immobilienscout24.de/expose/123?keep=1";
    expect(
      analyseJobTargetsListing({
        jobListingId: null,
        jobUrl: "https://www.immobilienscout24.de/expose/123",
        jobLooksPrivate: false,
        listingId,
        listingSourceUrl: portal,
        listingIsPrivate: false,
      }),
    ).toBe(true);
    expect(
      analyseJobTargetsListing({
        jobListingId: null,
        jobUrl: portal,
        jobLooksPrivate: true,
        listingId,
        listingSourceUrl: portal,
        listingIsPrivate: false,
      }),
    ).toBe(false);
    expect(
      analyseJobTargetsListing({
        jobListingId: null,
        jobUrl: "https://manuelle-eingabe.immopulse/html/pending",
        jobLooksPrivate: true,
        listingId,
        listingSourceUrl: "https://manuelle-eingabe.immopulse/html/abc",
        listingIsPrivate: true,
      }),
    ).toBe(true);
    expect(analyseJobLooksPrivate({ url: portal, stepDetail: "Analyse vorbereitet" })).toBe(false);
    expect(
      analyseJobLooksPrivate({
        url: portal,
        stepDetail: "Analyse vorbereitet · eingefügte Sitzung",
      }),
    ).toBe(true);
    expect(analyseListingUrlCandidates(portal).some((url) => url.includes("/expose/123"))).toBe(
      true,
    );
    expect(analyseListingUrlCandidates(portal)).toEqual(
      expect.arrayContaining([
        "https://www.immobilienscout24.de/expose/123?keep=1",
        "https://immobilienscout24.de/expose/123?keep=1",
      ]),
    );
    expect(analyseListingUrlCandidates("https://immobilienscout24.de/expose/123")).toEqual(
      expect.arrayContaining([
        "https://immobilienscout24.de/expose/123",
        "https://www.immobilienscout24.de/expose/123",
      ]),
    );
    expect(
      analyseListingUrlCandidates(
        "https://www.kleinanzeigen.de/s-anzeige/wohnung/123?utm_source=share",
      ),
    ).toEqual(
      expect.arrayContaining([
        "https://kleinanzeigen.de/s-anzeige/wohnung/123",
        "https://www.kleinanzeigen.de/s-anzeige/wohnung/123",
      ]),
    );
  });
});

describe("job poll client", () => {
  it("stoppt bei 401/403, überspringt 429 und merged recent", () => {
    const src = readFileSync(
      path.join(__dirname, "../../components/analyse/analyse-job-context.tsx"),
      "utf8",
    );
    expect(src).toContain("denyAuth");
    expect(src).toContain("listRes.status === 401 || listRes.status === 403");
    expect(src).toContain("listRes.status === 429");
    expect(src).toContain("data.recent");
    expect(src).toContain("isAnalyseJobPayload");
    expect(src).toContain("isValidUuid(job.listingId)");
    expect(src).toContain('toast.error("Bitte erneut anmelden")');
    expect(src).toContain("stoppedRef.current = false");
  });
});

describe("normalizeStepLog", () => {
  it("ersetzt Exception-Leaks in Logzeilen", () => {
    const entries = normalizeStepLog([
      "Exposé wird geladen…",
      'Traceback (most recent call last):\n  File "app.py"',
      { msg: "Analyse fehlgeschlagen: httpx.ConnectError: [Errno 111]", kind: "line" },
    ]);
    expect(entries[0]?.msg).toBe("Exposé wird geladen…");
    expect(entries[1]?.msg).toBe("Bei der Analyse ist ein unerwarteter Fehler aufgetreten.");
    expect(entries[2]?.msg).toBe("Bei der Analyse ist ein unerwarteter Fehler aufgetreten.");
  });
});

describe("normalizePreview", () => {
  it("übernimmt nur kauf oder miete als Angebotstyp", () => {
    expect(normalizePreview({ preis: 1250, angebotstyp: "miete" })?.angebotstyp).toBe("miete");
    expect(normalizePreview({ preis: 198000, angebotstyp: "kauf" })?.angebotstyp).toBe("kauf");
    expect(normalizePreview({ angebotstyp: "sonstiges" })?.angebotstyp).toBeNull();
  });
});

describe("formatLogTime", () => {
  it("zeigt Job-Logs in Europe/Berlin", () => {
    expect(formatLogTime("2026-08-10T21:30:00.000Z")).toBe("23:30:00");
    expect(formatLogTime("ungültig")).toBe("--:--:--");
  });
});
