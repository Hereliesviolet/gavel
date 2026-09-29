import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FULL_KI_DAILY_LIMIT, fullKiQuotaReached } from "@/lib/zvg-full-analyse";

describe("Vollanalyse-Quota", () => {
  it("blockt ab dem Tageslimit", () => {
    expect(fullKiQuotaReached(FULL_KI_DAILY_LIMIT - 1)).toBe(false);
    expect(fullKiQuotaReached(FULL_KI_DAILY_LIMIT)).toBe(true);
    expect(fullKiQuotaReached(FULL_KI_DAILY_LIMIT + 3)).toBe(true);
  });
});

describe("geteilte Vollanalyse-Route", () => {
  it("startet denselben Scraper-Job und prüft vorhandene Fulls", () => {
    const route = readFileSync(
      path.join(__dirname, "../../app/api/zvg/[slug]/ki/full/route.ts"),
      "utf8",
    );
    expect(route).toContain("/internal/analyze-zvg-listing");
    expect(route).toContain("isFullKiAnalysis");
    expect(route).toContain("isKiFullPending");
    expect(route).toContain("FULL_KI_DAILY_LIMIT");
    expect(route).toContain("already_full");
    expect(route).toContain("in_progress");
  });
});
