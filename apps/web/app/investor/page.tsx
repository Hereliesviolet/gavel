import type { Metadata } from "next";
import Link from "next/link";
import {
  fetchInvestmentCoverage,
  fetchInvestorPicks,
  fetchVeraenderungen,
  type Veraenderung,
} from "@/lib/investor-queries";
import { fetchDeskEintraege } from "@/lib/deal-desk";
import { hasHeroCaution, isExcludedFromHero } from "@/lib/investor-picks";
import { InvestorFeaturedDeal } from "@/components/investor/investor-featured-deal";
import { InvestorDealCard } from "@/components/investor/investor-deal-card";
import { DataTableGrid } from "@/components/ui/data-table-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { TrustRow } from "@/components/ui/trust-row";
import { auth } from "@/lib/auth";
import { getInvestorProfile } from "@/lib/investor-profile-storage";
import { DEFAULT_INVESTOR_PROFILE } from "@/lib/investor-profile";
import { calendarDaysUntil, formatDate, isUpcomingTermin } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";
import { favoritedListingIds } from "@/lib/favorite-write";

export const metadata: Metadata = {
  title: "Heute | KI Investor",
  description:
    "Die wenigen Zwangsversteigerungen, die heute Arbeit lohnen — mit Begründung, Konfidenz und offenen Datenlücken.",
};

const ART_LABEL: Record<Veraenderung["art"], string> = {
  wiederholungstermin: "Wiederholungstermin",
  wertreduktion: "Wertreduktion",
  neu: "Neu",
};

export default async function HeutePage() {
  const session = await auth();
  const profile = session?.user?.id
    ? await getInvestorProfile(session.user.id)
    : DEFAULT_INVESTOR_PROFILE;

  const [picks, veraenderungen, coverage, deskEintraege] = await Promise.all([
    fetchInvestorPicks("week", "all", 3, profile),
    fetchVeraenderungen(7, 8),
    fetchInvestmentCoverage(),
    session?.user?.id ? fetchDeskEintraege(session.user.id, profile) : [],
  ]);

  const [erster, ...weitere] = picks;
  const aufmacher =
    erster && !isExcludedFromHero(erster)
      ? { ...erster, heroCaution: hasHeroCaution(erster) }
      : null;
  const featuredFavorited =
    aufmacher != null && session?.user?.id
      ? (await favoritedListingIds(session.user.id, [aufmacher.listingId])).has(aufmacher.listingId)
      : false;
  const uebrige = aufmacher ? weitere : picks;
  const anstehend = deskEintraege.filter((eintrag) => {
    if (eintrag.offline || !isUpcomingTermin(eintrag.terminDate)) {
      return false;
    }
    const tage = calendarDaysUntil(eintrag.terminDate);
    return tage != null && tage <= 14;
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow={formatDate(new Date())}
        title="Heute"
        description={
          picks.length > 0
            ? `${picks.length} Objekte aus dem aktiven Bestand sind deine Zeit wert. Die Konfidenz neben jeder Chance sagt, worauf die Einschätzung beruht.`
            : "Aktuell erfüllt kein aktives Verfahren die Kriterien deines Profils. Das ist ein Ergebnis, keine Störung."
        }
        action={
          <Link
            href="/investor/suche"
            className="font-mono text-xs text-foreground hover:underline"
          >
            Alle Objekte
          </Link>
        }
      />

      {anstehend.length > 0 && (
        <section className="mb-6 rounded-[4px] border border-warning/40 bg-warning-container px-4 py-3">
          <p className="text-sm text-warning-container-fg">
            Auf deinem Desk stehen {anstehend.length} Termine in den nächsten 14 Tagen:{" "}
            {anstehend.slice(0, 3).map((eintrag, i) => (
              <span key={eintrag.listingId}>
                {i > 0 && ", "}
                <Link href={eintrag.href ?? "/investor/desk"} className="underline">
                  {eintrag.titel}
                </Link>{" "}
                ({formatDate(eintrag.terminDate)})
              </span>
            ))}
            {anstehend.length > 3 && " …"}
          </p>
        </section>
      )}

      {aufmacher && (
        <div className="mb-8">
          <InvestorFeaturedDeal
            pick={aufmacher}
            strategy="all"
            initialFavorited={featuredFavorited}
          />
        </div>
      )}

      {uebrige.length > 0 && (
        <section className="mb-10 space-y-3">
          <SectionHeader label={aufmacher ? "Ebenfalls einen Blick wert" : "Kandidaten"} />
          {uebrige.map((pick) => (
            <InvestorDealCard key={pick.listingId} pick={pick} />
          ))}
        </section>
      )}

      {picks.length === 0 && (
        <EmptyState
          className="mb-10"
          message="Kein aktives Verfahren erfüllt gerade dein Profil."
          action={
            <Link
              href="/investor/suche"
              className="font-mono text-xs text-foreground hover:underline"
            >
              Filter lockern
            </Link>
          }
        />
      )}

      <section className="mb-10">
        <SectionHeader
          label="Bewegung der letzten 7 Tage"
          action={
            <Link href="/investor/suche" className="text-xs hover:underline">
              Suche
            </Link>
          }
        />
        {veraenderungen.length > 0 ? (
          <DataTableGrid columns="140px 1fr 1fr 90px">
            <DataTableGrid.Head>
              <div>Art</div>
              <div>Objekt</div>
              <div>Änderung</div>
              <div>Datum</div>
            </DataTableGrid.Head>
            {veraenderungen.map((eintrag) => (
              <DataTableGrid.Row
                key={`${eintrag.listingId}-${eintrag.amDatum.toISOString()}`}
                href={zvgListingPath(eintrag.bundesland, eintrag.slug) ?? "/investor"}
              >
                <div className="font-mono text-[11px] text-muted-foreground">
                  {ART_LABEL[eintrag.art]}
                </div>
                <div className="text-sm font-medium truncate">{eintrag.titel}</div>
                <div className="text-sm text-muted-foreground truncate">{eintrag.beschreibung}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {formatDate(eintrag.amDatum)}
                </div>
              </DataTableGrid.Row>
            ))}
          </DataTableGrid>
        ) : (
          <EmptyState message="In den letzten 7 Tagen keine Terminverschiebung und keine Wertreduktion." />
        )}
      </section>

      <TrustRow
        items={[
          {
            label: "Abdeckung",
            value: `${coverage.pctMitInvestment} % der KI-Analysen mit Investmentbewertung`,
          },
          {
            label: "Quelle",
            value: "Datenbasis",
            href: "/investor/datenbasis",
          },
        ]}
      />
    </PageShell>
  );
}
