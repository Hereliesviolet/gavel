import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { fetchFinderPicks } from "@/lib/investor-queries";
import { parseFinderFiltersFromSearchParams } from "@/lib/investor-finder";
import { SucheFilter } from "@/app/investor/suche/suche-filter";
import { InvestorDealCard } from "@/components/investor/investor-deal-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { ResultBar, ResultChip } from "@/components/ui/result-bar";
import { auth } from "@/lib/auth";
import { getInvestorProfile } from "@/lib/investor-profile-storage";
import { DEFAULT_INVESTOR_PROFILE } from "@/lib/investor-profile";

export const metadata: Metadata = {
  title: "Suche | KI Investor",
  description:
    "Zwangsversteigerungen nach Strategie, Budget, Region und Termin filtern. Datenlücken werden ausgewiesen, nicht versteckt.",
};

export default async function SuchePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFinderFiltersFromSearchParams(sp);
  const session = await auth();
  const profile = session?.user?.id
    ? await getInvestorProfile(session.user.id)
    : DEFAULT_INVESTOR_PROFILE;
  const { picks, total, regionConflict } = await fetchFinderPicks(filters, profile);

  const chips = [
    typeof sp.preset === "string" && sp.preset && <ResultChip key="preset">{sp.preset}</ResultChip>,
    typeof sp.bundesland === "string" && sp.bundesland && (
      <ResultChip key="bl">{sp.bundesland}</ResultChip>
    ),
  ].filter(Boolean);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Investor · Suche"
        title="Suche"
        description={
          session?.user?.id ? (
            <>
              Alle aktiven Verfahren, nach deinen Kriterien eingegrenzt. Region und Objektart aus
              deinem{" "}
              <Link href="/account/investor" className="text-foreground hover:underline">
                Investorenprofil
              </Link>{" "}
              sind bereits angewendet. Der Filter steht in der URL.
            </>
          ) : (
            "Alle aktiven Verfahren, nach Kriterien eingegrenzt. Der Filter steht in der URL."
          )
        }
      />

      <ResultBar count={total} shown={picks.length} chips={chips} className="mb-4" />

      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-8">
        <Suspense fallback={null}>
          <SucheFilter total={total} shown={picks.length} />
        </Suspense>

        <div className="space-y-3 min-w-0">
          {picks.length > 0 ? (
            picks.map((pick) => <InvestorDealCard key={pick.listingId} pick={pick} />)
          ) : (
            <EmptyState
              message={
                regionConflict ? (
                  <>
                    Keine Überschneidung zwischen Suchfilter und{" "}
                    <Link href="/account/investor" className="text-foreground hover:underline">
                      Profil-Regionen
                    </Link>
                    .
                  </>
                ) : (
                  "Keine Treffer — Preset wechseln oder Filter lockern."
                )
              }
              action={
                <Link
                  href="/investor/suche"
                  className="font-mono text-xs text-foreground hover:underline"
                >
                  Filter zurücksetzen
                </Link>
              }
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
