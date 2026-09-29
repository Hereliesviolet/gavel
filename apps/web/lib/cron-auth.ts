import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export type CronAudience = "email" | "ops" | "metrics" | "jobs";

const SCOPED_SECRET_ENV: Record<CronAudience, string> = {
  email: "CRON_EMAIL_SECRET",
  ops: "CRON_OPS_SECRET",
  metrics: "METRICS_SECRET",
  jobs: "CRON_JOBS_SECRET",
};

export function cronSecretsMatch(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !authorizationHeader) return false;
  const expected = `Bearer ${secret}`;
  const provided = Buffer.from(authorizationHeader);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

export function cronSecretsForAudience(
  audience: CronAudience,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string[] {
  const scoped = env[SCOPED_SECRET_ENV[audience]]?.trim();
  if (scoped) return [scoped];
  if (audience === "metrics") return [];
  const shared = env.CRON_SECRET?.trim();
  return shared ? [shared] : [];
}

function cronUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

/** Fail-closed: ohne passendes Secret bleibt die Route geschlossen. */
export function rejectIfCronUnauthorized(
  req: NextRequest,
  audience: CronAudience = "jobs",
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): NextResponse | null {
  const secrets = cronSecretsForAudience(audience, env);
  if (secrets.length === 0) {
    console.error(`[cron-auth] ${SCOPED_SECRET_ENV[audience]}/CRON_SECRET fehlt`);
    return cronUnauthorized();
  }
  const header = req.headers.get("authorization");
  if (secrets.some((secret) => cronSecretsMatch(header, secret))) {
    return null;
  }
  return cronUnauthorized();
}
