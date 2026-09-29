import { describe, expect, it } from "vitest";
import { parseDataQualityReport } from "@/lib/data-quality-report";

const valid = {
  summary: {
    total_active: 10,
    total_needs_review: 2,
    by_source: { zvg: 10 },
    by_reason: [{ field: "preis", reason: "fehlt", count: 2 }],
  },
  previous: { total_needs_review: 1 },
};

describe("parseDataQualityReport", () => {
  it("nimmt gültige Zahlen und Listen", () => {
    expect(parseDataQualityReport(valid)).toEqual(valid);
  });

  it("lehnt fehlende oder nicht-numerische Felder ab", () => {
    expect(parseDataQualityReport({ summary: { total_active: "10" } })).toBeNull();
    expect(parseDataQualityReport({ summary: { ...valid.summary, total_active: -1 } })).toBeNull();
    expect(
      parseDataQualityReport({ summary: valid.summary, previous: { total_needs_review: "x" } }),
    ).toBeNull();
    expect(parseDataQualityReport(null)).toBeNull();
  });
});
