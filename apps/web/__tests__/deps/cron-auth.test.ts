import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  cronSecretsForAudience,
  cronSecretsMatch,
  rejectIfCronUnauthorized,
} from "@/lib/cron-auth";

describe("cronSecretsMatch", () => {
  it("akzeptiert den korrekten Bearer-Token", () => {
    expect(cronSecretsMatch("Bearer super-secret", "super-secret")).toBe(true);
  });

  it("lehnt fehlendes Secret, falsches Schema und abweichende Länge ab", () => {
    expect(cronSecretsMatch("Bearer super-secret", undefined)).toBe(false);
    expect(cronSecretsMatch(null, "super-secret")).toBe(false);
    expect(cronSecretsMatch("super-secret", "super-secret")).toBe(false);
    expect(cronSecretsMatch("Bearer other", "super-secret")).toBe(false);
    expect(cronSecretsMatch("Bearer super-secretx", "super-secret")).toBe(false);
  });
});

describe("cronSecretsForAudience", () => {
  it("nimmt das scoped Secret, sobald es gesetzt ist", () => {
    expect(
      cronSecretsForAudience("email", {
        CRON_SECRET: "shared",
        CRON_EMAIL_SECRET: "mail-only",
      }),
    ).toEqual(["mail-only"]);
    expect(cronSecretsForAudience("metrics", { CRON_SECRET: "shared" })).toEqual([]);
    expect(
      cronSecretsForAudience("metrics", {
        CRON_SECRET: "shared",
        METRICS_SECRET: "metrics-only",
      }),
    ).toEqual(["metrics-only"]);
    expect(cronSecretsForAudience("ops", { CRON_SECRET: "shared" })).toEqual(["shared"]);
    expect(cronSecretsForAudience("ops", {})).toEqual([]);
  });
});

describe("rejectIfCronUnauthorized", () => {
  it("verrät nicht, ob ein Secret fehlt", async () => {
    const req = new NextRequest("https://gavel.test/api/metrics");
    const denied = rejectIfCronUnauthorized(req, "metrics", {});
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get("cache-control")).toBe("no-store");
    expect(await denied?.json()).toEqual({ error: "Unauthorized" });
  });
});
