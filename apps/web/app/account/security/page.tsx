import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SectionHeader } from "@/components/ui/section-header";
import { PasswordForm } from "@/components/account/password-form";
import { TotpForm } from "@/components/account/totp-form";
import { getCurrentUser } from "@/lib/account";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sicherheit · Gavel" };

export default async function SecurityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/account/security");

  const user = await getCurrentUser(session.user.id);
  if (!user) redirect("/login?callbackUrl=/account/security");

  return (
    <div className="max-w-5xl space-y-8">
      <section>
        <SectionHeader label={user.hasPassword ? "Passwort ändern" : "Passwort festlegen"} />
        <div className="border border-border rounded-[4px] bg-card p-5">
          <PasswordForm totpEnabled={user.totpEnabled} hasPassword={user.hasPassword} />
        </div>
      </section>
      <section>
        <SectionHeader label="Zwei-Faktor-Authentifizierung" />
        <div className="border border-border rounded-[4px] bg-card p-5">
          <TotpForm enabled={user.totpEnabled} hasPassword={user.hasPassword} />
        </div>
      </section>
      <section>
        <SectionHeader label="Andere Geräte" />
        <div className="border border-border rounded-[4px] bg-card p-5">
          <p className="text-sm text-foreground">
            Meldet alle anderen Geräte ab, sobald du Passwort oder 2FA änderst.
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">
            Einzelne Sitzungen kannst du unter Aktive Sitzungen widerrufen — ohne Passwortwechsel.
          </p>
          <Link
            href="/account/sessions"
            className="inline-block mt-3 font-mono text-xs text-foreground hover:underline"
          >
            Zu den Sitzungen
          </Link>
        </div>
      </section>
    </div>
  );
}
