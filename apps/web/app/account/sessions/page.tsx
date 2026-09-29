import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { userLoginSessions } from "@/drizzle/schema";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { maskIp, describeUserAgent } from "@/lib/account";
import { MAX_LIVE_LOGIN_SESSIONS } from "@/lib/session-revocation";
import { DataTableGrid } from "@/components/ui/data-table-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { RevokeSessionButton } from "@/components/account/revoke-session-button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Aktive Sitzungen · Gavel" };

function formatSessionTime(value: Date | null | undefined) {
  return value?.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "—";
}

export default async function SessionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/account/sessions");

  const currentSid = (session as unknown as { sessionId?: string }).sessionId;

  const [active, revoked] = await Promise.all([
    db
      .select()
      .from(userLoginSessions)
      .where(
        and(eq(userLoginSessions.userId, session.user.id), isNull(userLoginSessions.revokedAt)),
      )
      .orderBy(desc(userLoginSessions.lastSeenAt))
      .limit(MAX_LIVE_LOGIN_SESSIONS),
    db
      .select()
      .from(userLoginSessions)
      .where(
        and(eq(userLoginSessions.userId, session.user.id), isNotNull(userLoginSessions.revokedAt)),
      )
      .orderBy(desc(userLoginSessions.revokedAt))
      .limit(10),
  ]);

  return (
    <div className="max-w-5xl space-y-8">
      <section>
        <SectionHeader label={`Aktive Sitzungen · ${active.length}`} />
        <p className="text-xs text-muted-foreground mb-3 max-w-2xl">
          Meldet unbekannte Geräte hier einzeln ab. Passwort- oder 2FA-Änderung beendet alle anderen
          Sitzungen automatisch.
        </p>
        {active.length === 0 ? (
          <EmptyState message="Keine aktiven Sitzungen." />
        ) : (
          <DataTableGrid columns="1fr 140px 150px 150px 110px">
            <DataTableGrid.Head>
              <div>Gerät</div>
              <div>IP</div>
              <div>Seit</div>
              <div>Zuletzt</div>
              <div>Aktion</div>
            </DataTableGrid.Head>
            {active.map((s) => {
              const isCurrent = s.id === currentSid;
              return (
                <DataTableGrid.Row key={s.id} highlight={isCurrent}>
                  <div className="text-sm min-w-0">
                    <span className="truncate">{describeUserAgent(s.userAgent)}</span>
                    {isCurrent && (
                      <span className="ml-2 font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[var(--primary-container)] text-[var(--primary-container-fg)]">
                        Diese Sitzung
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {maskIp(s.ipAddress)}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {formatSessionTime(s.createdAt)}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {formatSessionTime(s.lastSeenAt)}
                  </div>
                  <div>
                    {isCurrent ? (
                      <span className="font-mono text-[11px] text-muted-foreground">—</span>
                    ) : (
                      <RevokeSessionButton sessionId={s.id} />
                    )}
                  </div>
                </DataTableGrid.Row>
              );
            })}
          </DataTableGrid>
        )}
      </section>

      {revoked.length > 0 && (
        <section>
          <SectionHeader label={`Widerrufene Sitzungen · ${revoked.length}`} />
          <DataTableGrid columns="1fr 140px 180px" className="opacity-70">
            <DataTableGrid.Head>
              <div>Gerät</div>
              <div>IP</div>
              <div>Widerrufen</div>
            </DataTableGrid.Head>
            {revoked.slice(0, 10).map((s) => (
              <DataTableGrid.Row key={s.id}>
                <div className="text-sm truncate">{describeUserAgent(s.userAgent)}</div>
                <div className="font-mono text-xs text-muted-foreground">{maskIp(s.ipAddress)}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {formatSessionTime(s.revokedAt)}
                </div>
              </DataTableGrid.Row>
            ))}
          </DataTableGrid>
        </section>
      )}
    </div>
  );
}
