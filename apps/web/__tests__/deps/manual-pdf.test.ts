import { describe, expect, it } from "vitest";
import { decodeManualPdfBase64 } from "@/lib/manual-pdf";

describe("decodeManualPdfBase64", () => {
  it("akzeptiert ein kleines PDF", () => {
    const raw = Buffer.from("%PDF-1.4\n%").toString("base64");
    const result = decodeManualPdfBase64(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.subarray(0, 4).toString()).toBe("%PDF");
    }
  });

  it("lehnt Nicht-PDFs und ungültiges Base64 ab", () => {
    expect(decodeManualPdfBase64(Buffer.from("not-a-pdf").toString("base64")).ok).toBe(false);
    expect(decodeManualPdfBase64("@@@@").ok).toBe(false);
    expect(decodeManualPdfBase64("").ok).toBe(false);
  });
});
