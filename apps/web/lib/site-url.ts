/**
 * Öffentliche Basis-URL der Installation.
 *
 * Wird aus NEXTAUTH_URL gelesen (Pflichtvariable für Auth.js). Ohne Wert gilt
 * der lokale Dev-Server; es gibt bewusst keinen produktiven Hostnamen als
 * Fallback im Code.
 */

export const DEFAULT_SITE_URL = "http://localhost:3000";

type Env = Record<string, string | undefined>;

export function siteUrl(env: Env = process.env as Env): string {
  const raw = env.NEXTAUTH_URL?.trim();
  return (raw || DEFAULT_SITE_URL).replace(/\/+$/, "");
}

/** Hostname ohne Port, oder null, wenn die URL nicht parsebar ist. */
export function siteHostname(env: Env = process.env as Env): string | null {
  try {
    return new URL(siteUrl(env)).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Domain-Teil für ICS-UIDs und ähnliche Kennungen. */
export function siteIdDomain(env: Env = process.env as Env): string {
  return siteHostname(env) ?? "gavel.example";
}

/** User-Agent für Nominatim; die Nutzungsrichtlinie verlangt einen Kontakt. */
export function nominatimUserAgent(env: Env = process.env as Env): string {
  const contact = env.CONTACT_INFO?.trim();
  return contact ? `Gavel/1.0 (${contact})` : "Gavel/1.0";
}
