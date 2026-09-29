type SentryContext = Record<string, unknown>;

export type ParsedSentryDsn = {
  publicKey: string;
  host: string;
  projectId: string;
  storeUrl: string;
};

export function parseSentryDsn(dsn: string | undefined | null): ParsedSentryDsn | null {
  if (!dsn?.trim()) return null;
  try {
    const url = new URL(dsn.trim());
    const projectId = url.pathname.replace(/^\//, "").split("/")[0];
    if (!url.username || !url.hostname || !projectId) return null;
    return {
      publicKey: url.username,
      host: url.host,
      projectId,
      storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`,
    };
  } catch {
    return null;
  }
}

export async function captureException(error: unknown, context: SentryContext = {}): Promise<void> {
  const parsed = parseSentryDsn(process.env.SENTRY_DSN);
  if (!parsed) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: "gavel",
    server_name: process.env.DOMAIN ?? "gavel",
    exception: {
      values: [
        {
          type: err.name,
          value: err.message.slice(0, 2000),
          stacktrace: err.stack
            ? {
                frames: err.stack
                  .split("\n")
                  .slice(1, 21)
                  .map((line) => ({ filename: line.trim().slice(0, 500) })),
              }
            : undefined,
        },
      ],
    },
    extra: context,
    tags: { app: "web" },
  };

  try {
    await fetch(parsed.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": [
          "Sentry sentry_version=7",
          `sentry_client=gavel-web/1.0`,
          `sentry_key=${parsed.publicKey}`,
        ].join(", "),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    console.error("[sentry] Event konnte nicht gesendet werden", e);
  }
}

export function logServerError(scope: string, error: unknown, context: SentryContext = {}): void {
  console.error(scope, error);
  void captureException(error, { scope, ...context });
}
