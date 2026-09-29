import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "@/lib/json-ld";

describe("serializeJsonLd", () => {
  it("escaped HTML-Breaker in Beschreibungstexten", () => {
    const html = serializeJsonLd({
      description: "</script><script>alert(1)</script>",
    });
    expect(html).not.toContain("</script>");
    expect(html).toContain("\\u003c/script\\u003e");
  });
});
