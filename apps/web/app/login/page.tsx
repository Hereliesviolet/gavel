import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { TrustRow } from "@/components/ui/trust-row";
import { ssoIsConfigured, ssoLabel } from "@/lib/sso";

export const metadata = {
  title: "Anmelden · Gavel",
  robots: { index: false, follow: false },
};

// Liest SUPPORT_EMAIL und die SSO-Konfiguration zur Laufzeit, nicht beim Build.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const supportEmail = process.env.SUPPORT_EMAIL?.trim() || null;
  return (
    <div className="min-h-svh grid grid-cols-1 lg:grid-cols-[1fr_440px] bg-background">
      {/* LEFT — Identity stripe */}
      <aside className="hidden lg:flex flex-col justify-between p-10 border-r border-border bg-[var(--surface-toolbar)] relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--foreground) 0 1px, transparent 1px 24px)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <Logo />
          <div>
            <div className="font-semibold tracking-tight">Gavel</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Internes Investorenportal
            </div>
          </div>
        </div>

        <div className="relative space-y-6 max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight leading-[1.15]">
            Aktive Versteigerungen. KI-analysiert. Bundesweit.
          </h1>
          <div className="space-y-3 font-mono text-[11px] text-muted-foreground">
            <Bullet>Tägliche Aggregation von zvg-portal.de, zvg.com, hanmark.de</Bullet>
            <Bullet>Grundbuch, Mängel, Lage, Energieausweis automatisiert ausgewertet</Bullet>
            <Bullet>Alerts auf jede Filterkombination, E-Mail bei neuen Treffern</Bullet>
          </div>
        </div>

        <div className="relative flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Intern · privates Tool · keine öffentliche Zugriffe
        </div>
      </aside>

      {/* RIGHT — Login form */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-7">
          <div className="lg:hidden flex items-center gap-2.5 mb-2">
            <Logo />
            <span className="font-semibold tracking-tight">Gavel</span>
          </div>

          <div>
            <div className="label-mono">Anmeldung</div>
            <h2 className="text-2xl font-semibold tracking-tight mt-1.5">Bei Gavel anmelden</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              Zugang ist auf eingeladene Investoren beschränkt.
            </p>
          </div>

          <Suspense>
            <div className="surface-card">
              <LoginForm ssoName={ssoIsConfigured() ? ssoLabel() : null} />
            </div>
          </Suspense>

          <TrustRow
            className="border-t border-border/60 pt-5"
            items={[
              { label: "Zugang", value: "Nur mit Einladung" },
              ...(supportEmail
                ? [
                    {
                      label: "Support",
                      value: supportEmail,
                      href: `mailto:${supportEmail}`,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </main>
    </div>
  );
}

function Logo() {
  return (
    <div className="relative size-7 rounded-[4px] bg-accent">
      <div className="absolute inset-1.5 rounded-[2px] bg-background" />
      <div className="absolute left-[13px] top-1.5 h-4 w-0.5 bg-accent" />
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1.5 inline-block size-1 shrink-0 rounded-full bg-accent" />
      <span>{children}</span>
    </div>
  );
}
