import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMarketStats } from "@/lib/market-stats";
import { fetchDatenbasis } from "@/lib/datenbasis";
import { MARKTREFERENZ_MIN_STICHPROBE } from "@/lib/market-reference";
import {
  fetchAbdeckungsverlauf,
  fetchKalibrierung,
  MIN_KALIBRIERUNG_STICHPROBE,
  vergleicheAbdeckung,
} from "@/lib/lernschleife";
import { BUNDESLAENDER, formatCurrency, formatDate } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";
import { MarktCharts } from "@/components/investor/markt-charts";
import { DataTableGrid } from "@/components/ui/data-table-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/statistik/kpi-card";

export const metadata: Metadata = {
  title: "Datenbasis | KI Investor",
  description:
    "Woher die Zahlen kommen, wie weit sie reichen und wo sie fehlen: Abdeckung, Marktreferenz und Terminhistorie.",
};

export default async function DatenbasisPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/investor/datenbasis");

  const [stats, basis, verlauf, kalibrierung] = await Promise.all([
    getMarketStats(),
    fetchDatenbasis(),
    fetchAbdeckungsverlauf(),
    fetchKalibrierung(session.user.id),
  ]);

  const ersterLauf = verlauf.length > 1 ? verlauf[0] : null;
  const letzterLauf = verlauf.length > 1 ? verlauf[verlauf.length - 1] : null;
  const verlaufsZeilen =
    ersterLauf && letzterLauf
      ? vergleicheAbdeckung(ersterLauf.abdeckung, letzterLauf.abdeckung)
      : [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Investor · Datenbasis"
        title="Datenbasis"
        description="Worauf kannst du dich verlassen? Jede Zeile sagt, für welchen Anteil des aktiven Bestands eine Zahl überhaupt existiert. Eine ausgewiesene Lücke ist wertvoller als eine erfundene Präzision."
      />

      <section className="mb-8">
        <SectionHeader label="Bestand im Überblick" />
        <div className="border border-border rounded-[4px] overflow-hidden grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="AKTIVE OBJEKTE" value={`${stats.total.toLocaleString("de-DE")} Stück`} />
          <KpiCard
            label="NEU (7 TAGE)"
            value={`+${stats.neuLetzteWoche.toLocaleString("de-DE")} Stück`}
          />
          <KpiCard label="Ø VERKEHRSWERT" value={formatCurrency(stats.avgPreis) ?? "—"} />
          <KpiCard
            label="NÄCHSTER TERMIN"
            value={
              stats.naechsterTerminTage == null
                ? "—"
                : stats.naechsterTerminTage <= 0
                  ? "heute"
                  : `in ${stats.naechsterTerminTage} d`
            }
          />
          <KpiCard label="KI-ANALYSEN" value={`${stats.kiCount.toLocaleString("de-DE")} Stück`} />
          <KpiCard
            label="MIT EXPOSÉ"
            value={`${stats.exposeCount.toLocaleString("de-DE")} Stück`}
          />
        </div>
      </section>

      <section className="mb-10">
        <SectionHeader label="Markt" />
        <MarktCharts
          nachBundesland={stats.nachBundesland}
          nachKategorie={stats.nachKategorie}
          vwVerteilung={stats.vwVerteilung}
          dringlichkeit={stats.dringlichkeit}
          preiseNachKategorie={stats.preiseNachKategorie}
          topAmtsgerichte={stats.topAmtsgerichte}
          termineProMonat={stats.termineProMonat}
          topChancen={stats.topChancen}
          datenQualitaet={stats.datenQualitaet}
        />
      </section>

      <section className="mb-10">
        <SectionHeader label="Abdeckung" />
        <DataTableGrid columns="180px 220px 1fr">
          <DataTableGrid.Head>
            <div>Merkmal</div>
            <div>Abdeckung</div>
            <div>Was das bedeutet</div>
          </DataTableGrid.Head>
          {basis.abdeckung.map((zeile) => {
            const quote = zeile.gesamt > 0 ? Math.round((zeile.anzahl / zeile.gesamt) * 100) : 0;
            return (
              <DataTableGrid.Row key={zeile.merkmal}>
                <div>
                  <div className="text-sm text-foreground">{zeile.merkmal}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {zeile.grundgesamtheit}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 rounded-[4px] bg-muted">
                    <div className="h-1.5 rounded-[4px] bg-accent" style={{ width: `${quote}%` }} />
                  </div>
                  <span className="font-mono text-xs">
                    {quote} % ({zeile.anzahl}/{zeile.gesamt})
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{zeile.bedeutung}</div>
              </DataTableGrid.Row>
            );
          })}
        </DataTableGrid>
      </section>

      <section className="mb-10">
        <SectionHeader label="Herkunft" />
        <DataTableGrid columns="180px 1fr">
          <DataTableGrid.Head>
            <div>Quelle</div>
            <div>Stand</div>
          </DataTableGrid.Head>
          <DataTableGrid.Row>
            <div className="text-sm">Marktreferenz</div>
            <div className="text-xs text-muted-foreground">
              {basis.markt.vergleichsobjekte.toLocaleString("de-DE")} Vergleichsangebote in{" "}
              {basis.markt.mikromaerkte} Mikromärkten, davon {basis.markt.mikromaerkteBelastbar} mit
              mindestens {MARKTREFERENZ_MIN_STICHPROBE} Angeboten. Zuletzt geerntet:{" "}
              {formatDate(basis.markt.juengsteErnte)}. Angebotspreise sind keine Abschlusspreise.
            </div>
          </DataTableGrid.Row>
          <DataTableGrid.Row>
            <div className="text-sm">Terminhistorie</div>
            <div className="text-xs text-muted-foreground">
              {basis.historie.ereignisse.toLocaleString("de-DE")} erfasste Termin- und Wertstände
              seit {formatDate(basis.historie.seit)}.{" "}
              {basis.historie.objekteMitWiederholung > 0
                ? `${basis.historie.objekteMitWiederholung} Objekte mit Wiederholungstermin.`
                : "Bisher kein Wiederholungstermin beobachtet."}
            </div>
          </DataTableGrid.Row>
        </DataTableGrid>
      </section>

      <section className="mb-10">
        <SectionHeader label="Abdeckung im Zeitverlauf" />
        <p className="mb-3 text-sm text-muted-foreground max-w-2xl">
          Jeder Evaluationslauf hält den Abdeckungsstand fest. Nur so ist sichtbar, ob
          Nachextraktion und Markternte den Bestand tatsächlich besser machen.
        </p>
        {verlaufsZeilen.length > 0 && ersterLauf != null && letzterLauf != null ? (
          <DataTableGrid columns="1fr 100px 100px 160px">
            <DataTableGrid.Head>
              <div>Merkmal</div>
              <div>{formatDate(ersterLauf.datum)}</div>
              <div>{formatDate(letzterLauf.datum)}</div>
              <div>Veränderung</div>
            </DataTableGrid.Head>
            {verlaufsZeilen.map((zeile) => (
              <DataTableGrid.Row key={zeile.merkmal}>
                <div className="text-sm">{zeile.merkmal}</div>
                <div className="font-mono text-xs">{zeile.vorherPct} %</div>
                <div className="font-mono text-xs">{zeile.nachherPct} %</div>
                {zeile.deltaPp == null ? (
                  <div className="text-xs text-muted-foreground">Bezugsmenge geändert</div>
                ) : (
                  <div
                    className={`font-mono text-xs ${
                      zeile.deltaPp > 0
                        ? "text-accent"
                        : zeile.deltaPp < 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {zeile.deltaPp > 0 ? "+" : ""}
                    {zeile.deltaPp} pp
                  </div>
                )}
              </DataTableGrid.Row>
            ))}
          </DataTableGrid>
        ) : (
          <EmptyState
            message={
              verlauf.length === 1
                ? "Erst ein Lauf erfasst. Ein Verlauf entsteht ab dem zweiten Tag."
                : "Noch kein Evaluationslauf mit Abdeckungsstand erfasst."
            }
          />
        )}
      </section>

      <section className="mb-10">
        <SectionHeader label="Kalibrierung gegen erfasste Ergebnisse" />
        <p className="mb-3 text-sm text-muted-foreground max-w-2xl">
          Was das Modell geschätzt hat, gegen das, was im{" "}
          <Link href="/investor/desk" className="text-foreground hover:underline">
            Deal-Desk
          </Link>{" "}
          als Ergebnis erfasst wurde. Positive Abweichung heißt: die Realität lag über der
          Schätzung.
        </p>
        {kalibrierung.mitZahlen === 0 ? (
          <EmptyState
            message={
              kalibrierung.erfassteErgebnisse === 0
                ? `Noch keine Ergebnisse erfasst. Sobald im Deal-Desk Gebot, Kaufpreis, Miete oder Verkaufspreis eingetragen sind, rechnet diese Tabelle. Belastbar ab ${MIN_KALIBRIERUNG_STICHPROBE} Beobachtungen.`
                : `${kalibrierung.erfassteErgebnisse} Einträge im Deal-Desk, aber noch ohne vergleichbare Zahlen. Belastbar ab ${MIN_KALIBRIERUNG_STICHPROBE} Beobachtungen.`
            }
          />
        ) : (
          <DataTableGrid columns="140px 120px 150px 110px 1fr">
            <DataTableGrid.Head>
              <div>Größe</div>
              <div>Beobachtungen</div>
              <div>Median-Abweichung</div>
              <div>In der Spanne</div>
              <div>Was das bedeutet</div>
            </DataTableGrid.Head>
            {kalibrierung.zeilen.map((zeile) => (
              <DataTableGrid.Row key={zeile.groesse}>
                <div className="text-sm">{zeile.groesse}</div>
                <div className="font-mono text-xs">{zeile.stichprobe} Stück</div>
                <div className="font-mono text-xs">
                  {zeile.medianAbweichungPct == null
                    ? "—"
                    : `${zeile.medianAbweichungPct > 0 ? "+" : ""}${zeile.medianAbweichungPct} %`}
                  {zeile.stichprobe > 0 && zeile.stichprobe < MIN_KALIBRIERUNG_STICHPROBE && (
                    <span className="ml-2 text-muted-foreground">(zu wenig)</span>
                  )}
                </div>
                <div className="font-mono text-xs">
                  {zeile.innerhalbSpanne == null ? "—" : `${zeile.innerhalbSpanne} %`}
                </div>
                <div className="text-xs text-muted-foreground">{zeile.bedeutung}</div>
              </DataTableGrid.Row>
            ))}
          </DataTableGrid>
        )}
      </section>

      <section>
        <SectionHeader label="Nächste Versteigerungstermine" />
        {stats.naechsteTermine.length > 0 ? (
          <DataTableGrid columns="100px 1fr 160px 140px 120px">
            <DataTableGrid.Head>
              <div>Termin</div>
              <div>Objekt</div>
              <div>Amtsgericht</div>
              <div>Bundesland</div>
              <div>Verkehrswert</div>
            </DataTableGrid.Head>
            {stats.naechsteTermine.map((t) => (
              <DataTableGrid.Row
                key={t.id}
                href={zvgListingPath(t.bundesland, t.slug) ?? "/investor/datenbasis"}
              >
                <div className="font-mono text-xs whitespace-nowrap">
                  {formatDate(t.terminDate)}
                </div>
                <div>
                  <div className="text-sm truncate">{t.adresse ?? t.ort ?? t.aktenzeichen}</div>
                  {t.typ ? (
                    <div className="font-mono text-[11px] text-muted-foreground truncate">
                      {t.typ}
                    </div>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground truncate">{t.amtsgericht ?? "—"}</div>
                <div className="text-xs">
                  {BUNDESLAENDER.find((b) => b.slug === t.bundesland)?.name ?? t.bundeslandName}
                </div>
                <div className="font-mono text-xs whitespace-nowrap">
                  {formatCurrency(Number(t.verkehrswert) || null)}
                </div>
              </DataTableGrid.Row>
            ))}
          </DataTableGrid>
        ) : (
          <EmptyState message="Keine bevorstehenden Termine." />
        )}
      </section>
    </PageShell>
  );
}
