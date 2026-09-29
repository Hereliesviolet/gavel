import { describe, expect, it } from "vitest";
import { isFullKiAnalysis, isKiFullPending, kiAnalysisEmptyCopy } from "@/lib/ki-status";

describe("kiAnalysisEmptyCopy", () => {
  const now = Date.parse("2026-09-12T10:00:00.000Z");
  const scraping = "Objektdaten werden noch vollständig erfasst. Die KI-Analyse startet danach.";
  const pending = "KI-Analyse wird noch verarbeitet…";
  const missing =
    "Keine KI-Analyse vorhanden. Der Eintrag kann älter sein als die Analyse-Pipeline oder die Auswertung ist fehlgeschlagen.";

  it("zeigt Erfassung, solange der Scrape nicht abgeschlossen ist", () => {
    expect(kiAnalysisEmptyCopy({ createdAt: new Date("2026-09-11T12:00:00.000Z") }, now)).toBe(
      scraping,
    );
  });

  it("zeigt Verarbeitung nach abgeschlossenem Scrape", () => {
    expect(
      kiAnalysisEmptyCopy(
        {
          createdAt: new Date("2026-09-10T10:00:00.000Z"),
          scrapeCompletedAt: new Date("2026-09-11T12:00:00.000Z"),
        },
        now,
      ),
    ).toBe(pending);
    expect(kiAnalysisEmptyCopy({ scrapeCompletedAt: "2026-09-11T12:00:00.000Z" }, now)).toBe(
      pending,
    );
  });

  it("zeigt fehlend bei altem oder unvollständigem Bestand", () => {
    expect(kiAnalysisEmptyCopy({ createdAt: new Date("2026-09-09T10:00:00.000Z") }, now)).toBe(
      missing,
    );
    expect(
      kiAnalysisEmptyCopy({ scrapeCompletedAt: new Date("2026-09-09T10:00:00.000Z") }, now),
    ).toBe(missing);
    expect(kiAnalysisEmptyCopy({}, now)).toBe(missing);
  });
});

describe("KI-Analysetiefe", () => {
  it("erkennt Vollanalyse und laufende Jobs", () => {
    expect(isFullKiAnalysis({ analysisTier: "full" })).toBe(true);
    expect(isFullKiAnalysis({ analysisTier: "basic" })).toBe(false);
    expect(isFullKiAnalysis(null)).toBe(false);
    expect(isKiFullPending({ fullStatus: "queued" })).toBe(true);
    expect(isKiFullPending({ fullStatus: "running" })).toBe(true);
    expect(isKiFullPending({ fullStatus: "idle" })).toBe(false);
  });
});
