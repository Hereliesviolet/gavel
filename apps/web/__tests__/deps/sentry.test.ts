import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSentryDsn } from "@/lib/sentry";

describe("parseSentryDsn", () => {
  it("liest Host, Key und Projekt", () => {
    const parsed = parseSentryDsn("https://abc123@o1.ingest.sentry.io/456");
    expect(parsed).toEqual({
      publicKey: "abc123",
      host: "o1.ingest.sentry.io",
      projectId: "456",
      storeUrl: "https://o1.ingest.sentry.io/api/456/store/",
    });
  });

  it("bleibt ohne DSN stumm", () => {
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn("kein-dsn")).toBeNull();
  });
});

describe("onRequestError", () => {
  it("schickt Sentry nur den Pfad ohne Query", () => {
    const src = readFileSync(path.join(__dirname, "../../instrumentation.ts"), "utf8");
    expect(src).toContain("telemetryRequestPath(request.path)");
    expect(src).not.toContain("path: request.path,");
  });
});
