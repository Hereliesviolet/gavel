import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  totpEnabled: boolean;
  hasPassword: boolean;
  pendingEmail: string | null;
  pendingEmailExpiresAt: Date | null;
};

/**
 * Lädt den eingeloggten Nutzer frisch aus der DB statt aus dem JWT-Cookie.
 *
 * Wichtig für die Profil-Seite: Name/E-Mail im next-auth-JWT werden nur beim
 * Login gesetzt und bleiben bis zum nächsten Login "eingefroren". Nach einer
 * Profil-Änderung würde die UI sonst wieder die alten Werte zeigen, bis sich
 * der Nutzer neu einloggt. Ein direkter DB-Read umgeht das zuverlässig.
 */
export async function getCurrentUser(userId: string): Promise<CurrentUser | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      totpEnabled: true,
      passwordHash: true,
      pendingEmail: true,
      pendingEmailExpiresAt: true,
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    totpEnabled: user.totpEnabled,
    hasPassword: Boolean(user.passwordHash),
    pendingEmail: user.pendingEmail,
    pendingEmailExpiresAt: user.pendingEmailExpiresAt,
  };
}

export function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "??";
}

/** Kürzt eine IP-Adresse aus Datenschutzgründen (letztes Segment ausgeblendet). */
export function maskIp(ip?: string | null): string {
  if (!ip) return "Unbekannt";
  const first = ip.split(",")[0]?.trim();
  if (!first) return "Unbekannt";

  if (first.includes(".")) {
    const parts = first.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    return first;
  }

  if (first.includes(":")) {
    const parts = first.split(":").filter(Boolean);
    if (parts.length > 3) return `${parts.slice(0, 3).join(":")}::xxxx`;
    return first;
  }

  return first;
}

/** Grobe, dependency-freie User-Agent-Zusammenfassung (Browser · Betriebssystem). */
export function describeUserAgent(ua?: string | null): string {
  if (!ua) return "Unbekanntes Gerät";

  let browser = "Unbekannter Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari";

  let os = "";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iOS/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return os ? `${browser} · ${os}` : browser;
}
