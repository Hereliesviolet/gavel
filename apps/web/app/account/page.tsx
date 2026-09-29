import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { userAlerts } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, getInitials } from "@/lib/account";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTableGrid } from "@/components/ui/data-table-grid";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/auth/logout-button";
import { ProfileForm } from "@/components/account/profile-form";
import { pendingEmailIsActive } from "@/lib/email-change";
import { Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { shouldSkipAlertForMissingGeocode } from "@/lib/alert-geocode";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Account · Gavel" };

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/account");

  const userId = session.user.id;

  const dbUser = await getCurrentUser(userId);
  if (!dbUser) redirect("/login?callbackUrl=/account");

  const alerts = await db
    .select({
      id: userAlerts.id,
      name: userAlerts.name,
      alertType: userAlerts.alertType,
      isActive: userAlerts.isActive,
      lastTriggeredAt: userAlerts.lastTriggeredAt,
      criteria: userAlerts.criteria,
    })
    .from(userAlerts)
    .where(eq(userAlerts.userId, userId));

  const user = {
    initials: getInitials(dbUser.name, dbUser.email),
    name: dbUser.name ?? "Nutzer",
    email: dbUser.email,
  };

  return (
    <div className="max-w-5xl space-y-8">
      {/* HEADER CARD */}
      <section className="border border-border rounded-[4px] bg-card">
        <div className="flex items-center gap-5 p-5">
          <div className="size-16 rounded-[4px] bg-[var(--primary-container)] text-[var(--primary-container-fg)] flex items-center justify-center text-2xl font-semibold tracking-tight">
            {user.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <div className="text-xl font-semibold tracking-tight">{user.name}</div>
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                <Mail className="size-3" />
                {user.email}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* PROFIL */}
      <section>
        <SectionHeader label="Profil" />
        <ProfileForm
          initialName={user.name}
          initialEmail={user.email}
          pendingEmail={
            pendingEmailIsActive(dbUser.pendingEmailExpiresAt) ? dbUser.pendingEmail : null
          }
          totpEnabled={dbUser.totpEnabled}
          hasPassword={dbUser.hasPassword}
        />
      </section>

      {/* ALERTS */}
      {alerts.length > 0 && (
        <section>
          <SectionHeader
            label={`Aktive Alerts · ${alerts.length}`}
            action={
              <Link href="/account/alerts" className="text-xs text-primary hover:underline">
                Alle Alerts verwalten →
              </Link>
            }
          />
          <DataTableGrid columns="1fr 140px 160px">
            <DataTableGrid.Head>
              <div>Suchabfrage</div>
              <div>Typ</div>
              <div>Zuletzt geprüft</div>
            </DataTableGrid.Head>
            {alerts.map((a) => (
              <DataTableGrid.Row key={a.id}>
                <div className="font-mono text-sm">{a.name}</div>
                <div className="font-mono text-xs text-muted-foreground uppercase">
                  {a.alertType}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {shouldSkipAlertForMissingGeocode(
                    (a.criteria ?? {}) as Parameters<typeof shouldSkipAlertForMissingGeocode>[0],
                  )
                    ? "Umkreis ohne Koordinaten"
                    : a.lastTriggeredAt
                      ? formatDate(a.lastTriggeredAt)
                      : "—"}
                </div>
              </DataTableGrid.Row>
            ))}
          </DataTableGrid>
        </section>
      )}

      {/* ACCOUNT ACTIONS */}
      <section>
        <SectionHeader label="Account" />
        <div className="border border-border rounded-[4px] divide-y divide-border max-w-2xl">
          <ActionRow
            title="Abmelden"
            desc="Beendet die aktuelle Sitzung in diesem Browser."
            action={<LogoutButton size="sm" />}
          />
          <ActionRow
            title="Passwort und 2FA"
            desc="Passwort rotieren und Zwei-Faktor-Authentifizierung einrichten."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/account/security">Öffnen</Link>
              </Button>
            }
          />
        </div>
      </section>
    </div>
  );
}

function ActionRow({
  title,
  desc,
  action,
  destructive,
}: {
  title: string;
  desc: string;
  action: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <div className={`text-sm font-medium ${destructive ? "text-[var(--destructive)]" : ""}`}>
          {title}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
      {action}
    </div>
  );
}
