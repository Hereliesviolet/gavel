import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  alertDueSql,
  alertIsDue,
  normalizeAlertFrequency,
  parseAlertFrequency,
} from "@/lib/alert-frequency";

describe("parseAlertFrequency", () => {
  it("akzeptiert nur die drei gespeicherten Werte", () => {
    expect(parseAlertFrequency("instant")).toBe("instant");
    expect(parseAlertFrequency("daily")).toBe("daily");
    expect(parseAlertFrequency("weekly")).toBe("weekly");
    expect(parseAlertFrequency("yearly")).toBeNull();
    expect(parseAlertFrequency(null)).toBeNull();
  });
});

describe("normalizeAlertFrequency", () => {
  it("fällt auf daily zurück", () => {
    expect(normalizeAlertFrequency(null)).toBe("daily");
    expect(normalizeAlertFrequency("unknown")).toBe("daily");
    expect(normalizeAlertFrequency("instant")).toBe("instant");
  });
});

describe("alertIsDue", () => {
  const now = new Date("2026-09-12T10:00:00.000Z");

  it("lässt instant immer durch", () => {
    expect(alertIsDue("instant", now, now)).toBe(true);
  });

  it("sendet daily/weekly beim ersten Treffer", () => {
    expect(alertIsDue("daily", null, now)).toBe(true);
    expect(alertIsDue("weekly", undefined, now)).toBe(true);
  });

  it("hält daily 24 Stunden zurück", () => {
    expect(alertIsDue("daily", new Date("2026-09-11T10:00:01.000Z"), now)).toBe(false);
    expect(alertIsDue("daily", new Date("2026-09-11T09:59:00.000Z"), now)).toBe(true);
  });

  it("hält weekly 7 Tage zurück", () => {
    expect(alertIsDue("weekly", new Date("2026-09-06T10:00:00.000Z"), now)).toBe(false);
    expect(alertIsDue("weekly", new Date("2026-09-05T10:00:00.000Z"), now)).toBe(true);
  });
});

describe("alertDueSql", () => {
  it("filtert fällige Alerts vor dem Cron-Limit", () => {
    expect(alertDueSql).toEqual(expect.any(Function));
    const src = readFileSync(path.join(__dirname, "../../lib/alert-frequency.ts"), "utf8");
    expect(src).toContain("COALESCE(frequency, 'daily') = 'instant'");
    expect(src).toContain("last_triggered_at IS NULL");
    expect(src).toContain("NOT IN ('instant', 'weekly')");
    const cron = readFileSync(
      path.join(__dirname, "../../app/api/cron/check-alerts/route.ts"),
      "utf8",
    );
    expect(cron).toContain("alertDueSql(now)");
    expect(cron).toContain("alertIsDue(alert.frequency, alert.lastTriggeredAt, now)");
    expect(cron).toContain("NULLS FIRST, ${userAlerts.id} ASC");
    expect(cron).toContain("async function markAlertChecked");
    expect(cron).toContain("await markAlertChecked(alert.id, now)");
    expect(cron).toContain("if (toSend.length === 0)");
  });
});
