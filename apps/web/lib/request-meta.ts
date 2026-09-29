import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

const PROXY_ATTESTATION_HEADER = "x-gavel-proxy";

export function trustForwardedClientIp(
  headerSource?: Headers | null,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  const enabled = ["1", "true", "yes"].includes(
    (env.TRUST_PROXY_HEADERS ?? "").trim().toLowerCase(),
  );
  if (!enabled) return false;
  const secret = env.TRUST_PROXY_SECRET?.trim();
  if (!secret) return false;
  const provided = headerSource?.get(PROXY_ATTESTATION_HEADER) ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sanitizeClientIp(value: string | null | undefined): string | null {
  const ip = value?.trim() ?? "";
  return ip && isIP(ip) ? ip : null;
}

export function parseForwardedClientIp(headerSource?: Headers | null): string | null {
  const realIp = sanitizeClientIp(headerSource?.get("x-real-ip"));
  if (realIp) return realIp;
  const hops = (headerSource?.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.length === 1 ? sanitizeClientIp(hops[0]) : null;
}

export function extractClientInfoFromHeaders(
  headerSource?: Headers | null,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
) {
  const userAgent = headerSource?.get("user-agent") ?? null;
  if (!trustForwardedClientIp(headerSource, env)) {
    return { userAgent, ipAddress: null };
  }
  return { userAgent, ipAddress: parseForwardedClientIp(headerSource) };
}

export function extractClientInfo(
  request?: Request,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
) {
  return extractClientInfoFromHeaders(request?.headers ?? null, env);
}

function normalizeRequestHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/:(80|443)$/, "");
}

export function trustedMutationHosts(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string[] {
  const hosts = new Set<string>();
  for (const raw of [env.NEXTAUTH_URL, env.AUTH_URL]) {
    if (!raw?.trim()) continue;
    try {
      hosts.add(normalizeRequestHost(new URL(raw.trim()).host));
    } catch {
      continue;
    }
  }
  for (const extra of (env.AUTH_TRUSTED_HOSTS ?? "").split(",")) {
    const host = extra.trim();
    if (host) hosts.add(normalizeRequestHost(host));
  }
  return [...hosts];
}

export function isTrustedMutationOrigin(
  origin: string | null,
  referer: string | null,
  host: string | null,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  if (!host) return false;
  const raw = origin?.trim() || refererOrigin(referer);
  if (!raw) return false;
  try {
    const originHost = normalizeRequestHost(new URL(raw).host);
    const requestHost = normalizeRequestHost(host);
    if (originHost !== requestHost) return false;
    const allowed = trustedMutationHosts(env);
    if (allowed.length > 0) return allowed.includes(requestHost);
    return env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

function refererOrigin(referer: string | null): string | null {
  if (!referer?.trim()) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function rejectUntrustedMutation(
  req: Request,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): NextResponse | null {
  if (
    isTrustedMutationOrigin(
      req.headers.get("origin"),
      req.headers.get("referer"),
      req.headers.get("host"),
      env,
    )
  ) {
    return null;
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
