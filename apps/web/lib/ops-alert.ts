export type OpsAlert = {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

export type OpsAlertPayload = {
  status?: string;
  alerts?: OpsAlert[];
};

const MAX_ALERTS = 8;
const MAX_STATUS = 32;
const MAX_KEY = 80;
const MAX_VAL = 500;
const MAX_FIELDS = 20;

function clipRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key || key.length > MAX_KEY) continue;
    if (typeof value !== "string") continue;
    out[key] = value.slice(0, MAX_VAL);
    if (Object.keys(out).length >= MAX_FIELDS) break;
  }
  return Object.keys(out).length ? out : undefined;
}

function clipStatus(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const status = raw.trim().slice(0, MAX_STATUS);
  return status || undefined;
}

export function parseOpsAlertPayload(raw: unknown): OpsAlertPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const alertsIn = Array.isArray(obj.alerts) ? obj.alerts.slice(0, MAX_ALERTS) : [];
  const alerts: OpsAlert[] = [];
  for (const item of alertsIn) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const alert = item as Record<string, unknown>;
    alerts.push({
      status: clipStatus(alert.status),
      labels: clipRecord(alert.labels),
      annotations: clipRecord(alert.annotations),
    });
  }
  return {
    status: clipStatus(obj.status),
    alerts,
  };
}

export function formatOpsAlerts(payload: OpsAlertPayload): { title: string; body: string } {
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const first = alerts[0];
  const title =
    first?.annotations?.summary ||
    first?.labels?.alertname ||
    (payload.status === "resolved" ? "Alarm aufgelöst" : "Betriebsalarm");
  const lines = alerts.slice(0, MAX_ALERTS).map((alert) => {
    const name = alert.labels?.alertname ?? "Alarm";
    const summary = alert.annotations?.summary ?? alert.annotations?.description ?? "";
    return `${alert.status ?? payload.status ?? "firing"} · ${name}${summary ? ` — ${summary}` : ""}`;
  });
  return {
    title: title.slice(0, MAX_VAL),
    body: lines.join("\n") || "Prometheus hat einen Alarm ohne Details gemeldet.",
  };
}
