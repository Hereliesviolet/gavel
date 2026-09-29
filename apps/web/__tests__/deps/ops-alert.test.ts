import { describe, expect, it } from "vitest";
import { formatOpsAlerts, parseOpsAlertPayload } from "@/lib/ops-alert";

describe("formatOpsAlerts", () => {
  it("nimmt Summary und Alertname", () => {
    const formatted = formatOpsAlerts({
      status: "firing",
      alerts: [
        {
          status: "firing",
          labels: { alertname: "ScraperDown" },
          annotations: { summary: "Scraper-API ist nicht erreichbar" },
        },
      ],
    });
    expect(formatted.title).toBe("Scraper-API ist nicht erreichbar");
    expect(formatted.body).toContain("ScraperDown");
  });

  it("fällt ohne Alerts auf einen Standardtext zurück", () => {
    expect(formatOpsAlerts({ status: "resolved" }).title).toBe("Alarm aufgelöst");
    expect(formatOpsAlerts({}).body).toMatch(/ohne Details/);
  });
});

describe("parseOpsAlertPayload", () => {
  it("schneidet Arrays und String-Felder", () => {
    const parsed = parseOpsAlertPayload({
      status: "firing-with-a-very-long-status-value",
      alerts: Array.from({ length: 12 }, (_, i) => ({
        status: "firing",
        labels: { alertname: `A${i}`, nested: { x: 1 }, long: "x".repeat(800) },
        annotations: { summary: "ok", extra: 9 },
      })),
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toHaveLength(32);
    expect(parsed?.alerts).toHaveLength(8);
    expect(parsed?.alerts?.[0].labels?.long).toHaveLength(500);
    expect(parsed?.alerts?.[0].labels?.nested).toBeUndefined();
    expect(parsed?.alerts?.[0].annotations?.extra).toBeUndefined();
  });

  it("lehnt kein Objekt ab", () => {
    expect(parseOpsAlertPayload(null)).toBeNull();
    expect(parseOpsAlertPayload("firing")).toBeNull();
    expect(parseOpsAlertPayload([])).toBeNull();
  });
});
