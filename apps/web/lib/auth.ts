import NextAuth from "next-auth";
import { encode as encodeJwt } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, userLoginSessions } from "@/drizzle/schema";
import { headers } from "next/headers";
import { extractClientInfo, extractClientInfoFromHeaders } from "@/lib/request-meta";
import { LOGIN_RATE, clearRateLimit, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { AuthUnavailableError, TwoFactorRequiredError } from "@/lib/auth-errors";
import { lockAccountAndReverifyTotp } from "@/lib/account-lock";
import { isStepUpConsumedError } from "@/lib/account-step-up";
import { verifyTotpOrBackup } from "@/lib/totp";
import {
  SSO_PROVIDER_ID,
  ssoIsConfigured,
  ssoLabel,
  ssoProfileAllowed,
  ssoSignInDecision,
} from "@/lib/sso";
import { readAuthSecret } from "@/lib/auth-secret";
import {
  applyJwtUserLookup,
  clampEphemeralJwtExpiry,
  EPHEMERAL_SESSION_SECONDS,
  expireEphemeralJwtIdentity,
  jwtEncodeMaxAgeSeconds,
  jwtHasBoundSession,
  loginSessionMatchesToken,
  PERSISTENT_SESSION_SECONDS,
} from "@/lib/session-token";
import {
  createCappedLoginSession,
  markCappedSessionIdsRevoked,
  revokeExcessLiveSessionRows,
} from "@/lib/session-revocation";

const loginRateLimit = LOGIN_RATE;

function rememberFlag(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

function ssoProvider() {
  if (!ssoIsConfigured()) return null;
  return {
    id: SSO_PROVIDER_ID,
    name: ssoLabel(),
    type: "oidc" as const,
    issuer: process.env.AUTH_OIDC_ISSUER,
    clientId: process.env.AUTH_OIDC_CLIENT_ID,
    clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET,
    allowDangerousEmailAccountLinking: true,
  };
}

const extraProviders = [ssoProvider()].filter(
  (provider): provider is NonNullable<typeof provider> => provider != null,
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: readAuthSecret() ?? undefined,
  // Erforderlich für Self-Hosting hinter einem Reverse-Proxy (Caddy). Ohne
  // trustHost wirft next-auth v5 in production einen "UntrustedHost"-Fehler,
  // sobald über eine echte Domain statt localhost zugegriffen wird.
  trustHost: true,
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { type: "email", label: "E-Mail" },
        password: { type: "password", label: "Passwort" },
        totp: { type: "text", label: "Einmalcode" },
        remember: { type: "text", label: "Angemeldet bleiben" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const { userAgent, ipAddress } = extractClientInfo(request);
        const emailKey = (credentials.email as string).trim().toLowerCase();
        const rateLimitKey = `${emailKey}:${ipAddress ?? "unknown"}`;
        const accountLockKey = `account:${emailKey}`;

        if (
          (await isRateLimited(rateLimitKey, loginRateLimit)) ||
          (await isRateLimited(accountLockKey, loginRateLimit))
        ) {
          console.warn("[auth] Rate-Limit aktiv, Login-Versuch blockiert");
          return null;
        }

        try {
          const user = await db.query.users.findFirst({
            where: sql`lower(${users.email}) = ${emailKey}`,
          });

          if (!user?.passwordHash) {
            await recordRateLimitHit(rateLimitKey, loginRateLimit);
            await recordRateLimitHit(accountLockKey, loginRateLimit);
            return null;
          }

          const valid = await bcrypt.compare(credentials.password as string, user.passwordHash);

          if (!valid) {
            await recordRateLimitHit(rateLimitKey, loginRateLimit);
            await recordRateLimitHit(accountLockKey, loginRateLimit);
            return null;
          }

          const totp = typeof credentials.totp === "string" ? credentials.totp : "";
          if (user.totpEnabled) {
            if (!totp.trim()) {
              throw new TwoFactorRequiredError();
            }
            const verified = verifyTotpOrBackup(user.totpSecret, user.totpBackupHashes, totp);
            if (!verified.ok) {
              await recordRateLimitHit(rateLimitKey, loginRateLimit);
              await recordRateLimitHit(accountLockKey, loginRateLimit);
              return null;
            }
          }

          // Ohne sid kann Widerruf (/account/sessions) das JWT nicht binden.
          const { sessionId, revokedIds } = await db.transaction(async (tx) => {
            const locked = await lockAccountAndReverifyTotp(
              tx,
              user.id,
              user.totpEnabled ? totp : undefined,
            );
            if (locked.remainingHashes) {
              await tx
                .update(users)
                .set({ totpBackupHashes: locked.remainingHashes, updatedAt: new Date() })
                .where(eq(users.id, user.id));
            }
            const [row] = await tx
              .insert(userLoginSessions)
              .values({ userId: user.id, userAgent, ipAddress })
              .returning({ id: userLoginSessions.id });
            if (!row?.id) return { sessionId: undefined, revokedIds: [] as string[] };
            const excess = await revokeExcessLiveSessionRows(tx, user.id, row.id);
            return { sessionId: row.id, revokedIds: excess };
          });
          if (!sessionId) return null;
          await markCappedSessionIdsRevoked(revokedIds);

          await clearRateLimit(rateLimitKey, loginRateLimit);
          await clearRateLimit(accountLockKey, loginRateLimit);

          return {
            id: user.id,
            email: user.email,
            name: user.name ?? "",
            role: user.role ?? "user",
            sessionId,
            remember: rememberFlag(credentials.remember),
          };
        } catch (error) {
          if (error instanceof TwoFactorRequiredError) throw error;
          if (isStepUpConsumedError(error)) return null;
          console.error("[auth] credentials authorize failed:", error);
          throw new AuthUnavailableError();
        }
      },
    }),
    ...extraProviders,
  ],
  session: { strategy: "jwt", maxAge: PERSISTENT_SESSION_SECONDS },
  jwt: {
    async encode(params) {
      return encodeJwt({
        ...params,
        maxAge: jwtEncodeMaxAgeSeconds(params.token, params.maxAge ?? PERSISTENT_SESSION_SECONDS),
      });
    },
  },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials") return true;
      if (!ssoProfileAllowed(profile as { email_verified?: boolean } | undefined)) {
        return false;
      }
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;
      const existing = await db.query.users.findFirst({
        where: sql`lower(${users.email}) = ${email}`,
        columns: { id: true, totpEnabled: true },
      });
      return ssoSignInDecision(existing);
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account && account.provider !== "credentials") {
          const email = (user.email ?? "").trim().toLowerCase();
          const dbUser = await db.query.users.findFirst({
            where: sql`lower(${users.email}) = ${email}`,
          });
          if (!dbUser) return {};
          let sessionId: string | undefined;
          try {
            const incoming = await headers().catch(() => null);
            const { userAgent, ipAddress } = extractClientInfoFromHeaders(incoming);
            sessionId = await createCappedLoginSession({
              userId: dbUser.id,
              userAgent,
              ipAddress,
            });
          } catch (e) {
            console.error("[auth] SSO-Login-Session konnte nicht angelegt werden", e);
            throw e;
          }
          if (!sessionId) {
            throw new Error("SSO-Login-Session fehlt");
          }
          token.id = dbUser.id;
          token.role = dbUser.role ?? "user";
          token.sid = sessionId;
          token.persist = true;
        } else {
          const sessionId = (user as { sessionId?: string }).sessionId;
          if (!sessionId) return {};
          token.id = user.id;
          token.role = (user as { role?: string }).role ?? "user";
          token.sid = sessionId;
          token.persist = (user as { remember?: boolean }).remember !== false;
          if (token.persist === false) {
            token.persistUntil = Math.floor(Date.now() / 1000) + EPHEMERAL_SESSION_SECONDS;
          }
        }
      }
      if (token.id) {
        try {
          const row = await db.query.users.findFirst({
            where: eq(users.id, String(token.id)),
            columns: { role: true },
          });
          applyJwtUserLookup(token, row ?? null);
        } catch (e) {
          console.error("[auth] Rollen-Refresh fehlgeschlagen", e);
        }
      }
      return expireEphemeralJwtIdentity(clampEphemeralJwtExpiry(token));
    },
    async session({ session, token }) {
      if (!jwtHasBoundSession(token)) {
        if (session.user) {
          session.user.id = "";
          (session.user as { role?: string }).role = undefined;
        }
        return session;
      }

      if (session.user) {
        session.user.id = token.id;
        (session.user as { role?: string }).role = token.role as string;
      }

      const sid = token.sid;
      if (session.user) {
        (session as unknown as { sessionId?: string }).sessionId = sid;
        try {
          const loginSession = await db.query.userLoginSessions.findFirst({
            where: eq(userLoginSessions.id, sid),
          });
          if (!loginSession || !loginSessionMatchesToken(loginSession, token.id)) {
            // Sitzung wurde vom Nutzer widerrufen (siehe /account/sessions)
            // oder gehört nicht zu diesem JWT. Seiten/Routen prüfen
            // durchgängig auf `session.user.id`.
            session.user.id = "";
            (session.user as { role?: string }).role = undefined;
          } else {
            (session as unknown as { authenticatedAt?: number }).authenticatedAt =
              loginSession.createdAt.getTime();
            // "lastSeenAt" nur alle paar Minuten aktualisieren, um nicht bei
            // jedem einzelnen auth()-Aufruf (jede Seite/API-Route) einen
            // zusätzlichen DB-Write auszulösen.
            const staleSince = Date.now() - loginSession.lastSeenAt.getTime();
            if (staleSince > 5 * 60 * 1000) {
              void db
                .update(userLoginSessions)
                .set({ lastSeenAt: new Date() })
                .where(eq(userLoginSessions.id, sid))
                .catch((e) => {
                  console.error("[auth] lastSeenAt-Update fehlgeschlagen", e);
                });
            }
          }
        } catch (e) {
          console.error("[auth] Session-Revocation-Check fehlgeschlagen", e);
          session.user.id = "";
          (session.user as { role?: string }).role = undefined;
        }
      }

      return session;
    },
  },
});
