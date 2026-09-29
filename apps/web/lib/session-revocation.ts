import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { userLoginSessions } from "@/drizzle/schema";
import { redis } from "@/lib/redis";
import {
  isRevokedFromStoreLookups,
  isSessionRevokeRedisError,
  loginSessionMatchesToken,
  SessionRevokeRedisError,
  shouldSkipDbAfterRedisLookup,
} from "@/lib/session-token";

type SessionWriter = Pick<typeof db, "update" | "insert" | "execute" | "select">;

// ─────────────────────────────────────────────────────────────────────────
// Sicherheitsfix: zentrale Session-Widerrufsprüfung.
//
// Vorher wurde ein Widerruf (/api/account/sessions/[id]) nur in
// `user_login_sessions.revoked_at` vermerkt und erst beim nächsten
// `auth()`-Aufruf (session()-Callback in lib/auth.ts) berücksichtigt - das
// eigentliche JWT-Cookie blieb bis zu seinem Ablauf (`maxAge` = 30 Tage)
// gültig signiert und wurde vom globalen Auth-Gate (proxy.ts) weiterhin
// akzeptiert, weil dieses nur Signatur/Ablaufzeit prüfte, nicht den
// Widerrufsstatus. Ein gestohlenes/verlorenes, aber widerrufenes Cookie
// behielt dadurch vollen Lesezugriff auf private ZVG-/KI-Daten.
//
// Redis hält den Widerruf und einen kurzen Live-Marker, damit proxy.ts
// nicht bei jedem Request in die DB muss. Fehlt beides (oder fällt Redis
// aus), entscheidet `revoked_at`. lib/auth.ts prüft im session()-Callback
// unabhängig weiter gegen die DB.
// ─────────────────────────────────────────────────────────────────────────

const REVOKED_SESSION_PREFIX = "gavel:revoked-session:";
const LIVE_SESSION_PREFIX = "gavel:live-session:";

// Etwas großzügiger als die maximale Session-Laufzeit (30 Tage, siehe
// `session.maxAge` in lib/auth.ts), damit ein kurz vor Ablauf ausgestelltes
// JWT in jedem Fall bis zu seinem eigenen Ablauf als widerrufen markiert
// bleibt.
const REVOKED_SESSION_TTL_SECONDS = 31 * 24 * 60 * 60;
const LIVE_SESSION_TTL_SECONDS = 60;
export const MAX_LIVE_LOGIN_SESSIONS = 10;

function revokedSessionRedisKey(sid: string): string {
  return `${REVOKED_SESSION_PREFIX}${sid}`;
}

function liveSessionRedisKey(sid: string): string {
  return `${LIVE_SESSION_PREFIX}${sid}`;
}

async function lookupSessionRow(sid: string) {
  return db.query.userLoginSessions.findFirst({
    where: eq(userLoginSessions.id, sid),
    columns: { revokedAt: true, userId: true },
  });
}

/**
 * Markiert eine Login-Session sofort als widerrufen (Redis) und löscht den
 * Kurzzeit-Live-Marker. Wirft bei Redis-Fehler, damit Aufrufer nicht
 * „Erfolg“ melden, obwohl das Gate den Widerruf noch nicht sieht.
 */
export async function markSessionRevoked(sid: string): Promise<void> {
  try {
    const results = await redis
      .multi()
      .del(liveSessionRedisKey(sid))
      .set(revokedSessionRedisKey(sid), "1", "EX", REVOKED_SESSION_TTL_SECONDS)
      .exec();
    if (!results || results.some((entry) => entry && entry[0])) {
      throw new SessionRevokeRedisError();
    }
  } catch (error) {
    try {
      await redis.del(liveSessionRedisKey(sid));
    } catch (delError) {
      console.error(
        "[session-revocation] Live-Marker konnte nach Fehler nicht gelöscht werden",
        delError,
      );
    }
    throw isSessionRevokeRedisError(error) ? error : new SessionRevokeRedisError(error);
  }
}

/**
 * Schneller Check im globalen Auth-Gate (proxy.ts).
 *
 * Ein Redis-Widerruf reicht zum Sperren. Ein Live-Marker allein überspringt
 * die DB nicht — sonst gewinnt ein stehengebliebener Marker gegen
 * `revoked_at`. Fehlt Redis oder der Widerrufs-Key, entscheidet die DB.
 * Sind beide Speicher tot, wird der Request abgewiesen.
 */
export async function isSessionRevoked(sid: string, userId: string): Promise<boolean> {
  let redisLookup: { ok: true; revoked: boolean } | { ok: false } = { ok: false };
  try {
    const revoked = await redis.get(revokedSessionRedisKey(sid));
    redisLookup = { ok: true, revoked: revoked !== null };
    if (
      shouldSkipDbAfterRedisLookup({
        redisOk: true,
        redisRevoked: redisLookup.revoked,
      })
    ) {
      return true;
    }
  } catch (e) {
    console.error("[session-revocation] Redis-Check fehlgeschlagen, prüfe DB", e);
    redisLookup = { ok: false };
  }

  try {
    const row = await lookupSessionRow(sid);
    const dbLookup = {
      ok: true as const,
      revoked: !loginSessionMatchesToken(row, userId),
    };
    const revoked = isRevokedFromStoreLookups(redisLookup, dbLookup);
    if (revoked) {
      void markSessionRevoked(sid).catch((e) => {
        console.error("[session-revocation] Widerruf konnte nicht nachgezogen werden", e);
      });
    } else if (redisLookup.ok) {
      void redis.set(liveSessionRedisKey(sid), "1", "EX", LIVE_SESSION_TTL_SECONDS).catch((e) => {
        console.error("[session-revocation] Live-Marker konnte nicht gesetzt werden", e);
      });
    }
    return revoked;
  } catch (dbError) {
    console.error("[session-revocation] DB-Fallback fehlgeschlagen, sperre Request", dbError);
    return isRevokedFromStoreLookups(redisLookup, { ok: false });
  }
}

export async function revokeExcessLiveSessionRows(
  executor: SessionWriter,
  userId: string,
  keepSid: string,
  keep = MAX_LIVE_LOGIN_SESSIONS,
): Promise<string[]> {
  const live = await executor
    .select({ id: userLoginSessions.id })
    .from(userLoginSessions)
    .where(and(eq(userLoginSessions.userId, userId), isNull(userLoginSessions.revokedAt)))
    .orderBy(desc(userLoginSessions.createdAt), desc(userLoginSessions.id));

  const keepIds = new Set<string>([keepSid]);
  for (const row of live) {
    if (keepIds.size >= keep) break;
    keepIds.add(row.id);
  }
  const excessIds = live.filter((row) => !keepIds.has(row.id)).map((row) => row.id);
  if (excessIds.length === 0) return [];

  const revokedRows = await executor
    .update(userLoginSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userLoginSessions.userId, userId), inArray(userLoginSessions.id, excessIds)))
    .returning({ id: userLoginSessions.id });
  return revokedRows.map((row) => row.id);
}

export async function markCappedSessionIdsRevoked(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await markSessionIdsRevoked(ids);
  } catch (error) {
    if (!isSessionRevokeRedisError(error)) throw error;
    console.error("[session-revocation] Redis-Markierung nach Session-Cap fehlgeschlagen", error);
  }
}

export async function createCappedLoginSession(values: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<string | undefined> {
  const { sessionId, revokedIds } = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(userLoginSessions)
      .values(values)
      .returning({ id: userLoginSessions.id });
    if (!row?.id) return { sessionId: undefined, revokedIds: [] as string[] };
    const revokedIds = await revokeExcessLiveSessionRows(tx, values.userId, row.id);
    return { sessionId: row.id, revokedIds };
  });
  await markCappedSessionIdsRevoked(revokedIds);
  return sessionId;
}

export async function revokeOtherSessionRows(
  executor: SessionWriter,
  userId: string,
  currentSid?: string | null,
): Promise<string[]> {
  const revokedRows = await executor
    .update(userLoginSessions)
    .set({ revokedAt: new Date() })
    .where(
      currentSid
        ? and(eq(userLoginSessions.userId, userId), ne(userLoginSessions.id, currentSid))
        : eq(userLoginSessions.userId, userId),
    )
    .returning({ id: userLoginSessions.id });
  return revokedRows.map((row) => row.id);
}

export async function markSessionIdsRevoked(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const marks = await Promise.allSettled(ids.map((id) => markSessionRevoked(id)));
  if (marks.some((mark) => mark.status === "rejected")) {
    throw new SessionRevokeRedisError();
  }
}

export async function revokeOtherSessions(
  userId: string,
  currentSid?: string | null,
): Promise<string[]> {
  const revokedIds = await revokeOtherSessionRows(db, userId, currentSid);
  await markSessionIdsRevoked(revokedIds);
  return revokedIds;
}

export async function commitSensitiveAccountChange<T>(
  mutate: (tx: SessionWriter) => Promise<T>,
  userId: string,
  currentSid?: string | null,
): Promise<T> {
  const { result, revokedIds } = await db.transaction(async (tx) => {
    const result = await mutate(tx);
    const revokedIds = await revokeOtherSessionRows(tx, userId, currentSid);
    return { result, revokedIds };
  });
  try {
    await markSessionIdsRevoked(revokedIds);
  } catch (error) {
    if (!isSessionRevokeRedisError(error)) throw error;
    console.error("[session-revocation] Redis-Markierung nach DB-Widerruf fehlgeschlagen", error);
  }
  return result;
}
