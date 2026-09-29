import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink, MapPin, Info, TrendingUp, Coins } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  customUrlRequests,
  realEstateKiAnalyses,
  realEstateImages,
  userFavorites,
} from "@/drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { findAccessibleRealEstateListing } from "@/lib/analyse-access";
import { listingBeschreibungFromRaw } from "@/lib/listing-privacy";
import { isManualUploadUrl } from "@/lib/analyse-jobs";
import { parseUsableGeoPoint } from "@/lib/geo-point";
import { isSafePublicHttpsUrl, stripSensitiveUrlQuery } from "@/lib/safe-url";
import {
  formatCurrency,
  formatDate,
  formatPlzOrt,
  berechneErwerbskosten,
  hatDeutscheGrunderwerbsteuer,
  isValidUuid,
} from "@/lib/utils";
import { plzToBundesland } from "@/lib/bundesland";
import { fetchMarktreferenzFuerObjekt } from "@/lib/investor-queries";
import {
  berechneMarktluecke,
  listingKategorieFuerMarkt,
  marktmieteEur,
  marktreferenzLabel,
} from "@/lib/market-reference";
import {
  calculateInvestmentUnderwriting,
  flipKennzahlen,
  kaufpreisAusAngebot,
} from "@/lib/underwriting";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { GalleryHero } from "@/components/zvg/detail/gallery-hero";
import { KeyFactsStrip } from "@/components/zvg/detail/key-facts-strip";
import { StandortMap } from "@/components/zvg/detail/standort-map";
import { MapLinks } from "@/components/zvg/detail/map-links";
import { PreisBewertungIcon, PREIS_BEWERTUNG_LABEL } from "@/components/analyse/preis-bewertung";
import { MaengelSection } from "@/components/zvg/detail/ki-sections/maengel";
import { BodenrichtwertSection } from "@/components/zvg/detail/ki-sections/bodenrichtwert";
import { ModernisierungenSection } from "@/components/zvg/detail/ki-sections/modernisierungen";
import { InvestmentFixFlipSection } from "@/components/zvg/detail/ki-sections/investment-fixflip";
import { BuyHoldCard } from "@/components/zvg/detail/ki-sections/buy-hold";
import { EnergieausweisSection } from "@/components/zvg/detail/ki-sections/energieausweis";
import { ObjektzustandSection } from "@/components/zvg/detail/ki-sections/objektzustand";
import { BauInstandhaltungSection } from "@/components/zvg/detail/ki-sections/bau-instandhaltung";
import { LageSection } from "@/components/zvg/detail/ki-sections/lage";
import { OrteInDerNaeheSection } from "@/components/zvg/detail/ki-sections/orte-in-der-naehe";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { customListingImageSrc } from "@/lib/analyse-images";
import { getInvestorProfile } from "@/lib/investor-profile-storage";
import { DeleteAnalyseButton } from "./delete-button";

interface PageProps {
  params: Promise<{ listingId: string }>;
}

const ANGEBOTSTYP_LABEL: Record<string, string> = { kauf: "Kauf", miete: "Miete" };

function boolLabel(v: boolean | null | undefined): string | null {
  if (v == null) return null;
  return v ? "Ja" : "Nein";
}

export default async function AnalyseDetailPage({ params }: PageProps) {
  const session = await auth();
  const { listingId } = await params;
  if (!session?.user?.id) redirect(`/login?callbackUrl=/analyse/${listingId}`);
  if (!isValidUuid(listingId)) notFound();

  const listing = await findAccessibleRealEstateListing(session.user.id, listingId);
  if (!listing) notFound();

  const kategorie = listingKategorieFuerMarkt(null, listing.typ);
  const istKauf = listing.angebotstyp === "kauf";
  const [ki, images, favorite, marktreferenzKauf, marktreferenzMiete, ownSuccess, profile] =
    await Promise.all([
      db.query.realEstateKiAnalyses.findFirst({
        where: eq(realEstateKiAnalyses.listingId, listing.id),
        orderBy: [desc(realEstateKiAnalyses.analyzedAt)],
      }),
      db.query.realEstateImages.findMany({
        where: eq(realEstateImages.listingId, listing.id),
        orderBy: (img, { asc }) => [asc(img.position)],
      }),
      db.query.userFavorites.findFirst({
        where: and(
          eq(userFavorites.userId, session.user.id),
          eq(userFavorites.listingId, listing.id),
          eq(userFavorites.listingType, "real_estate"),
        ),
      }),
      fetchMarktreferenzFuerObjekt(listing.plz, kategorie, "kauf"),
      fetchMarktreferenzFuerObjekt(listing.plz, kategorie, "miete"),
      db.query.customUrlRequests.findFirst({
        where: and(
          eq(customUrlRequests.userId, session.user.id),
          eq(customUrlRequests.listingId, listing.id),
          eq(customUrlRequests.status, "success"),
        ),
        columns: { id: true },
      }),
      getInvestorProfile(session.user.id),
    ]);
  const marktreferenz =
    listing.angebotstyp === "miete"
      ? marktreferenzMiete
      : listing.angebotstyp === "kauf"
        ? marktreferenzKauf
        : null;
  const isFavorited = Boolean(favorite);

  // Markt-Fairness gegen die geernteten Vergleichsangebote statt gegen das
  // LLM-Urteil. Fehlt die Referenz, bleibt die LLM-Einschätzung sichtbar —
  // als Schätzung beschriftet, nicht als Messung.
  const marktLuecke = berechneMarktluecke(
    listing.preisProM2 == null ? null : Number(listing.preisProM2),
    marktreferenz,
  );

  const imageUrls = images
    .filter((i) => i.storagePath || i.publicUrl)
    .map((i) => ({ url: customListingImageSrc(listing.id, i.id) }));

  const beschreibung = listingBeschreibungFromRaw(listing.rawData);
  const preis = listing.preis;
  const bundesland = plzToBundesland(listing.plz);
  const erwerb =
    istKauf && preis && hatDeutscheGrunderwerbsteuer(bundesland)
      ? berechneErwerbskosten(preis, preis, bundesland)
      : null;
  const kannEntfernen = listing.submittedByUserId === session.user.id || Boolean(ownSuccess);

  const sourceUrl = listing.sourceUrl
    ? stripSensitiveUrlQuery(listing.sourceUrl)
    : listing.sourceUrl;
  const hasOriginalUrl = isSafePublicHttpsUrl(sourceUrl) && !isManualUploadUrl(sourceUrl);
  const coords = parseUsableGeoPoint(listing.lat, listing.lng);
  const lat = coords?.lat ?? null;
  const lng = coords?.lng ?? null;
  const hasCoords = coords != null;

  const marktmiete = marktmieteEur(
    listing.wohnflaecheM2 != null ? Number(listing.wohnflaecheM2) : null,
    marktreferenzMiete,
  );
  const listingMiete = listing.kaltmieteEur != null ? Number(listing.kaltmieteEur) : null;
  const kiMieteSchaetzungEur =
    ki?.moeglicherKaltmiete != null ? Number(ki.moeglicherKaltmiete) : undefined;
  const monthlyRentEur = marktmiete ?? listingMiete ?? kiMieteSchaetzungEur;

  const hausgeldEur =
    ki?.hausgeld != null
      ? Number(ki.hausgeld)
      : listing.hausgeldEur != null
        ? Number(listing.hausgeldEur)
        : undefined;

  // Dieselbe Rechnung wie bei ZVG-Objekten, nur mit dem Angebotspreis als
  // Kaufpreisannahme. Bis hierher schrieb der Scraper Gewinn und ROI in die
  // Datenbank, gerechnet mit anderen Annahmen als die Investor-Seiten.
  const kaufpreisAnnahme = istKauf ? kaufpreisAusAngebot(preis) : null;
  const flipAusUnderwriting =
    !istKauf || kaufpreisAnnahme == null || ki == null
      ? null
      : flipKennzahlen(
          calculateInvestmentUnderwriting(
            {
              purchasePriceEur: kaufpreisAnnahme.eur,
              kaufpreis: kaufpreisAnnahme,
              acquisitionCostsEur: erwerb?.gesamt ?? 0,
              courtValueEur: null,
              monthlyRentEur: monthlyRentEur ?? null,
              monthlyHausgeldEur: hausgeldEur ?? null,
              livingAreaM2: listing.wohnflaecheM2 == null ? null : Number(listing.wohnflaecheM2),
              renovationMinEur: ki.fixFlipGesamtkostenMinEur,
              renovationMaxEur: ki.fixFlipGesamtkostenMaxEur,
              arvMinEur: ki.arvMinEur,
              arvMaxEur: ki.arvMaxEur,
              holdingMonths: ki.holdingMonate,
            },
            profile,
          ),
        );

  const maengel = (ki?.maengel as unknown[]) ?? [];
  const modernisierungen = (ki?.modernisierungen as unknown[]) ?? [];
  const orte = (ki?.orteInDerNaehe as unknown[]) ?? [];

  const hasEnergie =
    ki?.energieausweisVorhanden != null ||
    Boolean(ki?.effizienzklasse || listing.effizienzklasse) ||
    ki?.endenergieverbrauchKwh != null ||
    listing.endenergiebedarfKwh != null;

  const hasObjektzustand =
    listing.denkmalschutz != null ||
    listing.vermietet != null ||
    Boolean(
      ki?.heizung ||
      listing.heizung ||
      ki?.zustandAussen ||
      ki?.zustandInnen ||
      ki?.maengelKurz ||
      ki?.wohnraeume ||
      ki?.restnutzungsdauerJ ||
      listing.zustandKurz,
    );

  const keyFacts = [
    listing.wohnflaecheM2 && { label: "WOHNFLÄCHE", value: `${listing.wohnflaecheM2} m²` },
    listing.zimmer && { label: "ZIMMER", value: String(listing.zimmer) },
    listing.baujahr && { label: "BAUJAHR", value: String(listing.baujahr) },
    listing.etage && { label: "ETAGE", value: listing.etage },
    listing.grundstuecksflaecheM2 && {
      label: "GRUNDSTÜCK",
      value: `${listing.grundstuecksflaecheM2} m²`,
    },
    listing.preisProM2 && {
      label: listing.angebotstyp === "miete" ? "MIETE/M²" : "PREIS/M²",
      value: formatCurrency(listing.preisProM2),
    },
    (ki?.effizienzklasse || listing.effizienzklasse) && {
      label: "ENERGIE",
      value: String(ki?.effizienzklasse || listing.effizienzklasse),
    },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="max-w-[var(--page-max-width)] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <Link href="/analyse" className="hover:text-primary">
          Custom-URL-Analyse
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium truncate">
          {listing.titel ?? "Analyse-Ergebnis"}
        </span>
      </nav>

      {imageUrls.length === 0 ? (
        <div
          className="relative flex items-start gap-3 rounded-[4px] border border-border bg-muted/40 px-4 py-5 mb-3"
          style={{ minHeight: 80 }}
        >
          <Info className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-sm flex-1">
            <p className="font-medium text-foreground mb-1">
              Für dieses Angebot sind keine Bilder verfügbar.
            </p>
            <p className="text-muted-foreground">
              {hasOriginalUrl ? (
                <>
                  Weitere Informationen finden Sie direkt in der{" "}
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    Originalanzeige
                    <ExternalLink className="size-3" />
                  </a>
                  .
                </>
              ) : (
                "Diese Analyse wurde aus eingefügtem HTML/PDF erstellt, ohne Bild-Erkennung."
              )}
            </p>
          </div>
          <div className="absolute top-2 right-2">
            <FavoriteButton
              listingId={listing.id}
              listingType="real_estate"
              initialFavorited={isFavorited}
            />
          </div>
        </div>
      ) : (
        <div className="relative mb-3">
          <GalleryHero images={imageUrls} />
          <div className="absolute top-2 right-2 z-10">
            <FavoriteButton
              listingId={listing.id}
              listingType="real_estate"
              initialFavorited={isFavorited}
            />
          </div>
        </div>
      )}

      {listing.istAktiv === false && (
        <div className="mb-4 flex items-start gap-2 rounded-[4px] border border-[var(--warning)]/40 bg-[var(--warning-container)] text-[var(--warning-container-fg)] p-3 text-sm">
          <span className="text-base shrink-0">⚠️</span>
          <span>
            <strong>Dieses Angebot ist nicht mehr online.</strong>
            <span className="ml-1 opacity-80">
              Preis und Verfügbarkeit können veraltet sein — vor einer Entscheidung die
              Originalanzeige prüfen.
            </span>
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Private Marktanalyse — erscheint nicht im KI-Investor (nur ZVG-Objekte).
      </p>

      {keyFacts.length > 0 && <KeyFactsStrip facts={keyFacts} className="mb-6" />}

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              {listing.titel ?? listing.typ ?? "Immobilie"}
            </h1>
            <p className="text-muted-foreground flex items-center gap-1 mb-2">
              <MapPin className="size-3.5" />
              {listing.adresse || formatPlzOrt(listing.plz, listing.ort) || "Adresse unbekannt"}
            </p>
            {preis ? (
              <p className="text-3xl font-bold text-primary">
                {formatCurrency(preis)}
                {listing.angebotstyp === "miete" ? (
                  <span className="text-lg font-medium text-muted-foreground"> / Monat</span>
                ) : null}
              </p>
            ) : (
              <p className="text-base text-muted-foreground italic">Preis nicht bekannt</p>
            )}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Allgemeine Informationen</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2.5">
                <Row label="Objekttyp" value={listing.typ} />
                <Row
                  label="Angebotstyp"
                  value={
                    listing.angebotstyp
                      ? (ANGEBOTSTYP_LABEL[listing.angebotstyp] ?? listing.angebotstyp)
                      : null
                  }
                />
                <Row label="Adresse" value={listing.adresse} />
                {listing.plz && (
                  <Row label="PLZ / Ort" value={formatPlzOrt(listing.plz, listing.ort)} />
                )}
                {listing.wohnflaecheM2 && (
                  <Row label="Wohnfläche" value={`${listing.wohnflaecheM2} m²`} />
                )}
                {listing.nutzflaecheM2 && (
                  <Row label="Nutzfläche" value={`${listing.nutzflaecheM2} m²`} />
                )}
                {listing.grundstuecksflaecheM2 && (
                  <Row label="Grundstück" value={`${listing.grundstuecksflaecheM2} m²`} />
                )}
                {listing.zimmer && <Row label="Zimmer" value={String(listing.zimmer)} />}
                {listing.etage && <Row label="Etage" value={listing.etage} />}
                {listing.anzahlEtagen && (
                  <Row label="Etagen gesamt" value={String(listing.anzahlEtagen)} />
                )}
                {listing.baujahr && <Row label="Baujahr" value={String(listing.baujahr)} />}
                {(ki?.effizienzklasse || listing.effizienzklasse) && (
                  <Row
                    label="Effizienzklasse"
                    value={String(ki?.effizienzklasse || listing.effizienzklasse)}
                  />
                )}
                {listing.energieausweisTyp && (
                  <Row label="Energieausweis" value={listing.energieausweisTyp} />
                )}
                {(ki?.heizung || listing.heizung) && (
                  <Row label="Heizung" value={String(ki?.heizung || listing.heizung)} />
                )}
                {listing.zustandKurz && <Row label="Zustand" value={listing.zustandKurz} />}
                <Row label="Denkmalschutz" value={boolLabel(listing.denkmalschutz)} />
                <Row label="Vermietet" value={boolLabel(listing.vermietet)} />
                {hausgeldEur != null && (
                  <Row label="Hausgeld" value={`${formatCurrency(hausgeldEur)} / Monat`} />
                )}
                {listing.kaltmieteEur != null && (
                  <Row
                    label="Bestands-Kaltmiete"
                    value={`${formatCurrency(listing.kaltmieteEur)} / Monat`}
                  />
                )}

                {beschreibung && (
                  <>
                    <Separator />
                    <div className="flex gap-4">
                      <dt className="text-sm text-muted-foreground font-medium w-28 sm:w-44 shrink-0">
                        Beschreibung:
                      </dt>
                      <dd className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                        {beschreibung}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          {ki ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">
                  {istKauf ? "KI-Markt- und Investment-Einschätzung" : "KI-Markt-Einschätzung"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <PreisBewertungIcon bewertung={ki.preisBewertung} />
                    <span className="font-semibold text-foreground">
                      {PREIS_BEWERTUNG_LABEL[ki.preisBewertung ?? "unbekannt"] ?? "Unbekannt"}
                    </span>
                    {marktLuecke != null ? (
                      <span className="text-sm text-muted-foreground">
                        ({marktLuecke > 0 ? "−" : "+"}
                        {Math.abs(Math.round(marktLuecke))}% gegenüber vergleichbaren Angeboten)
                      </span>
                    ) : (
                      ki.preisAbweichungPct != null && (
                        <span className="text-sm text-muted-foreground">
                          {(() => {
                            const pct = Number(ki.preisAbweichungPct);
                            if (pct > 0)
                              return `+${pct}% teurer als der Marktdurchschnitt (KI-Schätzung)`;
                            if (pct < 0)
                              return `${pct}% günstiger als der Marktdurchschnitt (KI-Schätzung)`;
                            return "auf Marktniveau (KI-Schätzung)";
                          })()}
                        </span>
                      )
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {marktLuecke != null
                      ? `${marktreferenzLabel(marktreferenz)}, Stand ${marktreferenz?.stand ? formatDate(marktreferenz.stand) : "unbekannt"}`
                      : `Vergleichsbasis: ${marktreferenzLabel(marktreferenz)} — die Prozentangabe ist eine KI-Schätzung ohne Vergleichsstichprobe`}
                  </span>
                </div>

                {ki.zusammenfassung && (
                  <p className="text-sm text-foreground leading-relaxed">{ki.zusammenfassung}</p>
                )}

                {((ki.staerken as string[])?.length > 0 ||
                  (ki.schwaechen as string[])?.length > 0) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {(ki.staerken as string[])?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-success mb-1.5">Stärken</div>
                        <ul className="flex flex-col gap-1">
                          {(ki.staerken as string[]).map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex gap-1.5">
                              <span className="text-success">+</span> {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(ki.schwaechen as string[])?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-destructive mb-1.5">
                          Schwächen
                        </div>
                        <ul className="flex flex-col gap-1">
                          {(ki.schwaechen as string[]).map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex gap-1.5">
                              <span className="text-destructive">−</span> {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {ki.lageBewertung && (
                  <div>
                    <div className="text-xs font-semibold text-foreground mb-1">Lage</div>
                    <p className="text-sm text-muted-foreground">{ki.lageBewertung}</p>
                  </div>
                )}

                {istKauf && ki.renditeGeschaetztPct != null && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Geschätzte Bruttomietrendite: </span>
                    <span className="font-semibold text-foreground">
                      {Number(ki.renditeGeschaetztPct)}%
                    </span>
                  </div>
                )}

                {istKauf && ki.cashflowEinschaetzung && (
                  <div>
                    <div className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1">
                      <Coins className="size-3.5 text-muted-foreground" /> Cashflow-Einschätzung
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {ki.cashflowEinschaetzung}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground text-sm">
                  Für diese Analyse liegt keine KI-Auswertung vor.
                </p>
              </CardContent>
            </Card>
          )}

          {ki && (
            <>
              {maengel.length > 0 && <MaengelSection maengel={maengel as any} />}
              <BodenrichtwertSection
                eurM2={ki.bodenrichtwertEurM2}
                stichtag={ki.bodenrichtwertStichtag}
                berechnung={ki.bodenrichtwertBerechnung}
              />
              {modernisierungen.length > 0 && (
                <ModernisierungenSection modernisierungen={modernisierungen as any} />
              )}
              {istKauf && (
                <InvestmentFixFlipSection
                  investmentScore={ki.investmentScore}
                  investmentScoreBegruendung={ki.investmentScoreBegruendung}
                  risikenInvestor={(ki.risikenInvestor as string[]) ?? []}
                  fixFlipMassnahmen={(ki.fixFlipMassnahmen as any) ?? []}
                  fixFlipWerteinschaetzung={ki.fixFlipWerteinschaetzung}
                  fixFlipGesamtkostenMinEur={ki.fixFlipGesamtkostenMinEur}
                  fixFlipGesamtkostenMaxEur={ki.fixFlipGesamtkostenMaxEur}
                  moeglicherKaltmiete={ki.moeglicherKaltmiete}
                  hausgeld={ki.hausgeld}
                  jahresrohertrag={ki.jahresrohertrag}
                  liegenschaftszinssatz={ki.liegenschaftszinssatz}
                  ertragswert={ki.ertragswert}
                  kaufpreisEur={kaufpreisAnnahme?.eur}
                  kaufpreisLabel={kaufpreisAnnahme?.label}
                  erwerbsnebenkostenEur={erwerb?.gesamt}
                  arvMinEur={ki.arvMinEur}
                  arvMaxEur={ki.arvMaxEur}
                  arvBegruendung={ki.arvBegruendung}
                  arvKonfidenz={ki.arvKonfidenz}
                  flip={flipAusUnderwriting}
                  financingRatePct={profile.financingRatePct}
                />
              )}
              {istKauf && (
                <BuyHoldCard
                  kaufpreisEur={kaufpreisAnnahme?.eur}
                  kaufpreisLabel={kaufpreisAnnahme?.label}
                  marktmieteEur={marktmiete}
                  kiMieteSchaetzungEur={kiMieteSchaetzungEur}
                  hausgeldEur={hausgeldEur}
                  wohnflaecheM2={listing.wohnflaecheM2}
                  bundesland={bundesland !== "unbekannt" ? bundesland : undefined}
                />
              )}
              {hasEnergie && (
                <EnergieausweisSection
                  vorhanden={ki.energieausweisVorhanden}
                  effizienzklasse={ki.effizienzklasse ?? listing.effizienzklasse}
                  ausweisjahr={ki.ausweisjahr}
                  energietraeger={ki.energietraeger}
                  endenergieverbrauchKwh={
                    ki.endenergieverbrauchKwh != null
                      ? String(ki.endenergieverbrauchKwh)
                      : listing.endenergiebedarfKwh != null
                        ? String(listing.endenergiebedarfKwh)
                        : null
                  }
                />
              )}
              {hasObjektzustand && (
                <ObjektzustandSection
                  denkmalschutz={listing.denkmalschutz}
                  innenbesichtigung={ki.innenbesichtigung}
                  vermietet={listing.vermietet}
                  restnutzungsdauerJ={ki.restnutzungsdauerJ}
                  heizung={ki.heizung ?? listing.heizung}
                  wohnraeume={ki.wohnraeume}
                  zustandAussen={ki.zustandAussen}
                  zustandInnen={ki.zustandInnen ?? listing.zustandKurz}
                  maengelKurz={ki.maengelKurz}
                />
              )}
              <BauInstandhaltungSection
                baubeschreibung={ki.baubeschreibung}
                instandhaltung={ki.instandhaltung}
              />
              <LageSection
                einwohner={ki.lageEinwohner}
                region={ki.lageRegion}
                verkehr={ki.lageVerkehr}
                charakter={ki.lageCharakter}
                umgebung={ki.lageUmgebung}
              />
              {orte.length > 0 && <OrteInDerNaeheSection orte={orte as any} />}
            </>
          )}

          {(listing.adresse || hasCoords) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Standort</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {hasCoords && (
                  <StandortMap
                    lat={lat!}
                    lng={lng!}
                    adresse={listing.adresse}
                    verkehrswert={preis}
                    priceLabel={listing.angebotstyp === "miete" ? "Kaltmiete" : "Angebotspreis"}
                  />
                )}
                <MapLinks
                  lat={hasCoords ? lat : null}
                  lng={hasCoords ? lng : null}
                  adresse={listing.adresse}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
          {erwerb && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-1.5">
                  <TrendingUp className="size-4 text-primary" /> Erwerbsnebenkosten
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Grobe Schätzung auf Basis des Angebotspreises
                </p>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Grunderwerbsteuer ({(erwerb.grunderwerbsteuerRate * 100).toFixed(1)} %)
                    </dt>
                    <dd className="font-medium">{formatCurrency(erwerb.grunderwerbsteuer)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Grundbucheintrag</dt>
                    <dd className="font-medium">{formatCurrency(erwerb.grundbucheintrag)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Notarkosten (pauschal)</dt>
                    <dd className="font-medium">{formatCurrency(erwerb.zuschlagsgebuehr)}</dd>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <dt className="font-semibold text-foreground">Gesamt Nebenkosten</dt>
                    <dd className="font-bold text-primary">{formatCurrency(erwerb.gesamt)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground mt-3">
                  Ohne Maklerprovision. Bundesland grob aus der PLZ abgeleitet - im Einzelfall
                  prüfen.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Info className="size-4 text-muted-foreground" /> Quelle
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {hasOriginalUrl ? (
                <Button variant="default" className="w-full" asChild>
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4 mr-1.5" />
                    Original ansehen
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Eingereicht per HTML-Einfügung/PDF-Upload, keine Original-URL hinterlegt.
                </p>
              )}
              {kannEntfernen && <DeleteAnalyseButton listingId={listing.id} />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-4">
      <dt className="text-sm text-muted-foreground font-medium w-28 sm:w-44 shrink-0">{label}:</dt>
      <dd className="text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}
