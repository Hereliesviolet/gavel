import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  MapPin,
  ExternalLink,
  Mail,
  FileText,
  Download,
  Scale,
  Building2,
  Info,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgListings, zvgKiAnalyses, zvgImages, userFavorites } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  BUNDESLAENDER,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPlzOrt,
  cn,
  berechneErwerbskosten,
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
} from "@/lib/utils";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { CalendarActions } from "@/components/zvg/calendar-actions";
import { GalleryHero } from "@/components/zvg/detail/gallery-hero";
import { KeyFactsStrip } from "@/components/zvg/detail/key-facts-strip";
import { StandortMap } from "@/components/zvg/detail/standort-map";
import { MapLinks } from "@/components/zvg/detail/map-links";
import { BietergrenzeBar } from "@/components/ui/bietergrenze-bar";
import { GrundbuchSection } from "@/components/zvg/detail/ki-sections/grundbuch";
import { MaengelSection } from "@/components/zvg/detail/ki-sections/maengel";
import { BelastungenSection } from "@/components/zvg/detail/ki-sections/belastungen";
import { BodenrichtwertSection } from "@/components/zvg/detail/ki-sections/bodenrichtwert";
import { ModernisierungenSection } from "@/components/zvg/detail/ki-sections/modernisierungen";
import { InvestmentFixFlipSection } from "@/components/zvg/detail/ki-sections/investment-fixflip";
import { BuyHoldCard } from "@/components/zvg/detail/ki-sections/buy-hold";
import { EnergieausweisSection } from "@/components/zvg/detail/ki-sections/energieausweis";
import { ObjektzustandSection } from "@/components/zvg/detail/ki-sections/objektzustand";
import { BauInstandhaltungSection } from "@/components/zvg/detail/ki-sections/bau-instandhaltung";
import { LageSection } from "@/components/zvg/detail/ki-sections/lage";
import { OrteInDerNaeheSection } from "@/components/zvg/detail/ki-sections/orte-in-der-naehe";
import { InvestmentMemoSection } from "@/components/investor/investment-memo-section";
import { FullAnalyseCta } from "@/components/zvg/detail/full-analyse-cta";
import { isFullKiAnalysis, kiAnalysisEmptyCopy } from "@/lib/ki-status";
import { getListingBySlug } from "./get-listing";
import { listingImageSrc, stripSensitiveUrlQuery } from "@/lib/safe-url";
import { findBundesland } from "@/lib/bundesland";
import {
  isDirectlinkUsable,
  isPublicZvgSourceUrl,
  publicZvgDocumentHref,
  zvgListingPath,
} from "@/lib/zvg-documents";
import { parseUsableGeoPoint } from "@/lib/geo-point";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  fetchPeerBenchmark,
  fetchMarktreferenzFuerObjekt,
  fetchTerminsdaten,
} from "@/lib/investor-queries";
import {
  berechneMarktluecke,
  listingKategorieFuerMarkt,
  listingKategorieFuerPeer,
  marktmieteEur,
} from "@/lib/market-reference";
import { flipKennzahlen, kaufpreisAusZvg } from "@/lib/underwriting";
import { buildInvestmentMemo } from "@/lib/investor-memo";
import { LISTING_COVER_ORDER } from "@/lib/listing-cover";
import { listingFlaecheFuerPreis, listingPreisProM2 } from "@/lib/listing-preis";
import { getInvestorProfile } from "@/lib/investor-profile-storage";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { Separator } from "@/components/ui/separator";
import { TrustRow } from "@/components/ui/trust-row";
import { Badge } from "@/components/ui/badge";
import { siteIdDomain, siteUrl } from "@/lib/site-url";

interface PageProps {
  params: Promise<{ bundesland: string; slug: string }>;
}

const BASE_URL = siteUrl();

// Alle Bundesländer nutzen das zentrale Bundes-ZVG-Portal (zvg-portal.de)
// mit dem jeweiligen Länderkürzel als Filter.
const ZVG_LAND_ABK: Record<string, string> = {
  "baden-wuerttemberg": "bw",
  badenwuerttemberg: "bw",
  bayern: "by",
  berlin: "be",
  // ACHTUNG: zvg-portal.de nutzt für Brandenburg das Kürzel "br" (nicht "bb"
  // wie das amtliche Kfz-/ISO-Kürzel). Mit "bb" liefert die Seite einen
  // "ERRROR: falsche Parameter übergeben"-Fehler. Verifiziert per curl gegen
  // https://www.zvg-portal.de/index.php?button=Suchen am 2026-07-03. Siehe
  // auch scrapers/src/sources/zvg_portal.py (BUNDESLAND_ABK).
  brandenburg: "br",
  bremen: "hb",
  hamburg: "hh",
  hessen: "he",
  "mecklenburg-vorpommern": "mv",
  niedersachsen: "ni",
  "nordrhein-westfalen": "nw",
  "rheinland-pfalz": "rp",
  saarland: "sl",
  sachsen: "sn",
  "sachsen-anhalt": "st",
  "schleswig-holstein": "sh",
  thueringen: "th",
};

function zvgLandAbk(bundesland: string): string | undefined {
  const slug = findBundesland(bundesland)?.slug;
  if (slug && ZVG_LAND_ABK[slug]) return ZVG_LAND_ABK[slug];
  return ZVG_LAND_ABK[bundesland];
}

function getJustizportalUrl(bundesland: string): string {
  const abk = zvgLandAbk(bundesland);
  if (abk) {
    return `https://www.zvg-portal.de/index.php?button=Termine+suchen&land_abk=${abk}`;
  }
  return "https://www.zvg-portal.de/";
}

/**
 * Normalisiert ein Aktenzeichen für die Anzeige:
 * - Bezirk auf 4 Stellen mit führenden Nullen: "41" → "0041"
 * - Laufnummer auf 4 Stellen mit führenden Nullen: "50" → "0050"
 * - 2-stelliges Jahr → 4-stellig, Bindestrich → Schrägstrich
 * - Format ohne Bezirksnummer (Bremen/Hamburg): "K 6-25" → "K 0006/2025"
 * - Hanmark-Wiederholungstermine (#N-Suffix) bleiben erhalten
 * - Unbekannte Formate (alphanumerischer Bezirk etc.) unverändert
 */
function formatAktenzeichen(az: string | null | undefined): string {
  if (!az) return "—";
  const trimmed = az.trim();

  // Format 1: "NNNN K NNNN/YYYY" oder "N K N/YY" (mit Bezirksnummer, optional #N-Suffix)
  const m1 = trimmed.match(/^0*(\d+)\s+K\s+0*(\d+)[/\-](\d{2,4})(#\d+)?$/i);
  if (m1) {
    const [, bezirk, nr, jahr, suffix] = m1;
    const fullJahr = jahr.length === 2 ? `20${jahr}` : jahr;
    return `${bezirk.padStart(4, "0")} K ${nr.padStart(4, "0")}/${fullJahr}${suffix ?? ""}`;
  }

  // Format 2: "K NNNN/YYYY" (ohne Bezirksnummer — Bremen, Hamburg; optional #N-Suffix)
  const m2 = trimmed.match(/^K\s+0*(\d+)[/\-](\d{2,4})(#\d+)?$/i);
  if (m2) {
    const [, nr, jahr, suffix] = m2;
    const fullJahr = jahr.length === 2 ? `20${jahr}` : jahr;
    return `K ${nr.padStart(4, "0")}/${fullJahr}${suffix ?? ""}`;
  }

  // Unbekanntes Format (z.B. alphanumerischer Bezirk "38a K 1-25"): unverändert
  return trimmed;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { bundesland, slug } = await params;
  const listing = await getListingBySlug(bundesland, slug);
  if (!listing) return {};

  const locationLabel =
    listing.ort?.trim() || formatPlzOrt(listing.plz, listing.ort) || listing.bundeslandName || "";
  const titlePlace = locationLabel ? ` in ${locationLabel}` : "";
  const title = `${listing.typ ?? "Immobilie"}${titlePlace} – ${listing.aktenzeichen ? formatAktenzeichen(listing.aktenzeichen) : "—"}`;
  const description =
    listing.beschreibung?.substring(0, 160) ??
    `Zwangsversteigerung: ${listing.typ ?? "Immobilie"}${listing.adresse ? ` in ${listing.adresse}` : titlePlace}. Verkehrswert: ${listing.verkehrswert ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(listing.verkehrswert)) : "—"}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}${zvgListingPath(listing.bundesland, listing.slug) ?? `/${bundesland}/${slug}`}`,
      type: "website",
    },
  };
}

export default async function DetailPage({ params }: PageProps) {
  // zweite Verteidigungslinie zusätzlich zum
  // globalen Auth-Gate (proxy.ts) und app/layout.tsx - siehe ausführlicher
  // Kommentar in der übergeordneten [bundesland]/page.tsx. Diese Seite
  // exponiert zusätzlich die KI-Analyse (u.a. Grundbuch-, Belastungs- und
  // Mängeldaten), daher besonders sensibel.
  const session = await auth();
  const { bundesland, slug } = await params;
  if (!session?.user?.id) {
    redirect(`/login?from=${zvgListingPath(bundesland, slug) ?? "/"}`);
  }

  const listing = await getListingBySlug(bundesland, slug);

  if (!listing) notFound();

  const gutachtenHref = publicZvgDocumentHref(
    listing.gutachtenUrl,
    listing.slug,
    "gutachten",
    listing.bundesland,
  );
  const exposeHref = publicZvgDocumentHref(
    listing.exposeUrl,
    listing.slug,
    "expose",
    listing.bundesland,
  );

  const [
    ki,
    images,
    benchmark,
    investorProfile,
    marktreferenzMiete,
    marktreferenzKauf,
    terminsdaten,
    favorite,
  ] = await Promise.all([
    db.query.zvgKiAnalyses.findFirst({
      where: eq(zvgKiAnalyses.listingId, listing.id),
    }),
    db.query.zvgImages.findMany({
      where: eq(zvgImages.listingId, listing.id),
      orderBy: LISTING_COVER_ORDER,
    }),
    fetchPeerBenchmark(
      listingKategorieFuerPeer(listing.kategorie, listing.typ),
      listing.bundesland,
    ),
    getInvestorProfile(session.user.id),
    fetchMarktreferenzFuerObjekt(
      listing.plz,
      listingKategorieFuerMarkt(listing.kategorie, listing.typ),
      "miete",
    ),
    fetchMarktreferenzFuerObjekt(
      listing.plz,
      listingKategorieFuerMarkt(listing.kategorie, listing.typ),
      "kauf",
    ),
    fetchTerminsdaten(listing.id),
    db.query.userFavorites.findFirst({
      where: and(
        eq(userFavorites.userId, session.user.id),
        eq(userFavorites.listingId, listing.id),
        eq(userFavorites.listingType, "zvg"),
      ),
      columns: { listingId: true },
    }),
  ]);
  const isFavorited = Boolean(favorite);

  const land = findBundesland(bundesland) ?? findBundesland(listing.bundesland);
  const landSlug = land?.slug ?? bundesland;
  const bl = land;

  const vw = listing.verkehrswert ? Number(listing.verkehrswert) : null;
  const wohnflaeche = listing.wohnflaecheM2 ? Number(listing.wohnflaecheM2) : null;
  const kaufpreis = kaufpreisAusZvg(vw, terminsdaten.geringstesGebotEur);
  const erwerb = vw != null ? berechneErwerbskosten(vw, kaufpreis?.eur ?? vw, landSlug) : null;
  // Die geerntete Marktmiete schlägt die Gutachten-/LLM-Schätzung, weil sie auf
  // beobachteten Forderungen beruht. Fehlt sie, bleibt die Schätzung sichtbar.
  const marktmiete = marktmieteEur(wohnflaeche, marktreferenzMiete);
  const gutachtenmiete = ki?.moeglicherKaltmiete == null ? null : Number(ki.moeglicherKaltmiete);
  const mieteFuerDetail = marktmiete ?? gutachtenmiete;
  const preisProM2 = listingPreisProM2(vw, listing);
  const preisFlaeche = listingFlaecheFuerPreis(listing);
  const kiIsFull = Boolean(ki) && isFullKiAnalysis(ki);
  const investmentMemo =
    ki && kiIsFull && process.env.INVESTOR_MEMO_ENABLED !== "false"
      ? buildInvestmentMemo({
          qualityInput: {
            listing: {
              verkehrswert: vw,
              wohnflaecheM2: wohnflaeche,
              terminDate: listing.terminDate,
              needsReview: listing.needsReview,
              dataQualityFlags: listing.dataQualityFlags,
            },
            ki: {
              moeglicherKaltmiete: ki.moeglicherKaltmiete,
              hausgeld: ki.hausgeld,
              fixFlipMassnahmen: ki.fixFlipMassnahmen,
              fixFlipGesamtkostenMinEur: ki.fixFlipGesamtkostenMinEur,
              fixFlipGesamtkostenMaxEur: ki.fixFlipGesamtkostenMaxEur,
              arvMinEur: ki.arvMinEur,
              arvMaxEur: ki.arvMaxEur,
              arvKonfidenz: ki.arvKonfidenz,
              innenbesichtigung: ki.innenbesichtigung,
              risikenInvestor: ki.risikenInvestor,
              analyzedAt: ki.analyzedAt,
            },
            preisProM2,
            benchmark,
            monthlyRentEur: mieteFuerDetail,
            marktlueckePct: berechneMarktluecke(preisProM2, marktreferenzKauf),
          },
          underwritingInput: {
            purchasePriceEur: kaufpreis?.eur ?? 0,
            kaufpreis,
            acquisitionCostsEur:
              kaufpreis != null && vw != null
                ? berechneErwerbskosten(vw, kaufpreis.eur, landSlug).gesamt
                : 0,
            bundesland: landSlug,
            courtValueEur: vw,
            referenceBidPct: kaufpreis?.anteilVerkehrswertPct ?? null,
            riskReserveEur: vw != null ? vw * 0.05 : 0,
            possessionReserveEur: vw != null && ki.innenbesichtigung !== true ? vw * 0.02 : 0,
            survivingRightsEur: terminsdaten.bestehendeRechteEur ?? 0,
            auctionTermsVerified:
              kaufpreis?.quelle === "geringstes_gebot" && terminsdaten.bestehendeRechteEur != null,
            unknownCostItems: [
              ...(kaufpreis?.quelle === "geringstes_gebot"
                ? []
                : ["Geringstes Gebot (nicht aus der Akte gelesen)"]),
              ...(terminsdaten.bestehendeRechteEur != null ? [] : ["Bestehenbleibende Rechte"]),
              "Räumungs-, Übergabe- und Vollstreckungskosten",
              ...(ki.innenbesichtigung === true
                ? []
                : ["Zustandsrisiko ohne bestätigte Innenbesichtigung"]),
            ],
            monthlyRentEur: mieteFuerDetail,
            monthlyHausgeldEur: ki.hausgeld == null ? null : Number(ki.hausgeld),
            livingAreaM2: wohnflaeche,
            renovationMinEur: ki.fixFlipGesamtkostenMinEur,
            renovationMaxEur: ki.fixFlipGesamtkostenMaxEur,
            arvMinEur: ki.arvMinEur,
            arvMaxEur: ki.arvMaxEur,
            holdingMonths: ki.holdingMonate,
          },
          investmentScore: ki.investmentScore,
          investmentReason: ki.investmentScoreBegruendung,
          risks: (ki.risikenInvestor as string[] | null) ?? [],
          benchmark,
          profile: investorProfile,
          sources: [
            ...(gutachtenHref
              ? [
                  {
                    label: "Verkehrswertgutachten",
                    kind: "official_document" as const,
                    url: gutachtenHref,
                    verified: true,
                    note: "Primärdokument; Inhalte und Aktualität vor dem Gebot selbst prüfen.",
                  },
                ]
              : []),
            ...(exposeHref
              ? [
                  {
                    label: "Amtliches Exposé",
                    kind: "official_document" as const,
                    url: exposeHref,
                    verified: true,
                    note: "Primärdokument; Inhalte und Aktualität vor dem Gebot selbst prüfen.",
                  },
                ]
              : []),
            ...(() => {
              const sourceUrl = stripSensitiveUrlQuery(
                listing.sourceUrl ?? listing.direktlink ?? "",
              );
              if (!isPublicZvgSourceUrl(sourceUrl)) return [];
              return [
                {
                  label: `Originalquelle ${listing.source}`,
                  kind: "listing_source" as const,
                  url: sourceUrl,
                  verified: true,
                  note: "Quellseite des Versteigerungstermins.",
                },
              ];
            })(),
          ],
        })
      : null;
  // Erwerbsnebenkosten auf die tatsächlich gerechnete Kaufpreisannahme, nicht
  // auf den Verkehrswert: sonst zeigt die Deal-Karte Nebenkosten zu einem
  // Preis, mit dem daneben niemand rechnet.
  const erwerbNachAnnahme =
    kaufpreis != null && vw != null ? berechneErwerbskosten(vw, kaufpreis.eur, landSlug) : null;
  const flipAusUnderwriting =
    investmentMemo != null ? flipKennzahlen(investmentMemo.underwriting) : null;
  // Die Zahlen bleiben sichtbar, bekommen aber ihren Vorbehalt danebengestellt.
  // Sonst liest sich eine Rechnung auf einem mit niedriger Konfidenz
  // geschätzten ARV wie ein Ergebnis.
  const flipVorbehalt =
    investmentMemo != null && !investmentMemo.quality.eligibility.fixFlip
      ? "Nicht belastbar: " +
        (investmentMemo.quality.warnings[0] ??
          "belastbarer ARV, positive konservative Marge oder dokumentierte Maßnahmen fehlen.")
      : null;

  const isArchived = !listing.istAktiv;

  // Korrekten land_abk im direktlink sicherstellen (Schutz vor Scraper-Bugs
  // wie einem veralteten/falschen land_abk-Wert, z.B. historisch "bb" statt
  // des korrekten "br" für Brandenburg – siehe ZVG_LAND_ABK oben). Dadurch
  // heilen auch ältere, mit dem falschen Kürzel gescrapte DB-Einträge beim
  // Rendern automatisch aus, ohne dass ein Backfill nötig ist.
  const correctAbk = zvgLandAbk(landSlug);

  // Aktenzeichen parsen, um zumindest das Bundesland auf der zvg-portal.de-
  // Suchseite vorzuselektieren. HINWEIS: zvg-portal.de führt die eigentliche
  // Aktenzeichen-Suche serverseitig nur per POST auf button=Suchen aus (Felder
  // az1/az3/az4) – der "Termine+suchen"-Button liefert nur das leere
  // Suchformular und ignoriert jegliche GET-Parameter zur Vorbefüllung. Eine
  // automatisch abschickende POST-Suche wäre zwar technisch möglich, wird
  // aber durch unsere eigene CSP (form-action 'self') zu Recht blockiert, da
  // sie sonst ein Cross-Origin-Formular zu einer fremden Domain erlauben
  // müsste. Wir verlinken daher bewusst nur auf die vorselektierte, aber
  // leere Suchseite – das Aktenzeichen wird zusätzlich als Text angezeigt,
  // damit Nutzer es manuell eintragen können (siehe Originalquelle-Card).
  const justizUrl = correctAbk
    ? `https://www.zvg-portal.de/index.php?button=Termine+suchen&land_abk=${correctAbk}`
    : getJustizportalUrl(bundesland);

  // Normalisiertes Aktenzeichen für die Anzeige (ohne führende Nullen, 4-stelliges Jahr)
  const azDisplay = listing.aktenzeichen ? formatAktenzeichen(listing.aktenzeichen) : undefined;
  const sanitizedDirektlink = listing.direktlink
    ? stripSensitiveUrlQuery(listing.direktlink)
    : listing.direktlink;
  const direktlinkFixed =
    sanitizedDirektlink && correctAbk
      ? sanitizedDirektlink.replace(/([?&]land_abk=)[^&]+/, `$1${correctAbk}`)
      : sanitizedDirektlink;

  // Nur einen tatsächlich funktionierenden Link in die Kalender-Beschreibung
  // aufnehmen – sonst (z.B. bei justizportal-showZvg-Links, die extern immer
  // mit "error" fehlschlagen) den Such-Fallback verwenden, damit auch der
  // Kalendereintrag niemals einen kaputten Link enthält.
  const calendarLink = isDirectlinkUsable(direktlinkFixed, listing.source)
    ? direktlinkFixed
    : justizUrl;

  const calendarTitle = listing.terminDate
    ? `${listing.typ?.trim() || "Immobilie"} – Versteigerung ${azDisplay ?? listing.aktenzeichen}`
    : null;
  const calendarLocation =
    listing.versteigerungsort ||
    [listing.adresse, listing.plz, listing.ort].filter(Boolean).join(", ") ||
    "";
  const pageUrl = `${BASE_URL}/${bundesland}/${slug}`;
  const calendarBody = [`Objekt: ${pageUrl}`, calendarLink ? `URL: ${calendarLink}` : null]
    .filter(Boolean)
    .join("\n");
  const googleCalUrl =
    calendarTitle && listing.terminDate
      ? buildGoogleCalendarUrl({
          title: calendarTitle,
          terminDate: listing.terminDate.toISOString(),
          location: calendarLocation,
          direktlink: calendarLink ?? undefined,
        })
      : null;
  const outlookCalUrl =
    calendarTitle && listing.terminDate
      ? buildOutlookCalendarUrl({
          title: calendarTitle,
          terminDate: listing.terminDate.toISOString(),
          location: calendarLocation,
          body: calendarBody,
        })
      : null;

  // Amtsgericht nicht anzeigen, wenn es nur den Bundesland-Namen enthält
  const bundeslaenderNamen = new Set(BUNDESLAENDER.map((b) => b.name));
  const amtsgerichtDisplay =
    listing.amtsgericht &&
    !bundeslaenderNamen.has(listing.amtsgericht) &&
    listing.amtsgericht !== listing.bundeslandName
      ? listing.amtsgericht
      : null;

  const coords = parseUsableGeoPoint(listing.lat, listing.lng);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: `${listing.typ ?? "Immobilie"}${listing.ort ? ` in ${listing.ort}` : ""}`,
    description: listing.beschreibung?.substring(0, 500) ?? undefined,
    url: `${BASE_URL}/${bundesland}/${slug}`,
    ...(listing.verkehrswert && {
      price: Number(listing.verkehrswert),
      priceCurrency: "EUR",
    }),
    address: {
      "@type": "PostalAddress",
      streetAddress: listing.adresse ?? undefined,
      postalCode: listing.plz ?? undefined,
      addressLocality: listing.ort ?? undefined,
      addressCountry: "DE",
    },
    ...(coords && {
      geo: {
        "@type": "GeoCoordinates",
        latitude: coords.lat,
        longitude: coords.lng,
      },
    }),
    ...((preisFlaeche?.m2 ?? listing.wohnflaecheM2) && {
      floorSize: {
        "@type": "QuantitativeValue",
        value: preisFlaeche?.m2 ?? Number(listing.wohnflaecheM2),
        unitCode: "MTK",
      },
    }),
    ...(listing.baujahr && { yearBuilt: listing.baujahr }),
  };

  const imageUrls = images.flatMap((i) => {
    const url = listingImageSrc(i.publicUrl);
    return url ? [{ url, position: i.position }] : [];
  });

  const nutzflaeche = listing.nutzflaecheM2 ? Number(listing.nutzflaecheM2) : null;
  const keyFacts = [
    nutzflaeche != null &&
      nutzflaeche > 0 && {
        label: "NUTZFLÄCHE",
        value: `${listing.nutzflaecheM2} m²`,
      },
    listing.wohnflaecheM2 && { label: "WOHNFLÄCHE", value: `${listing.wohnflaecheM2} m²` },
    listing.zimmer && { label: "ZIMMER", value: String(listing.zimmer) },
    listing.baujahr && { label: "BAUJAHR", value: String(listing.baujahr) },
    listing.etage != null && {
      label: "ETAGE",
      value: listing.etage === 0 ? "EG" : `${listing.etage}. OG`,
    },
    listing.grundstuecksflaecheM2 && {
      label: "GRUNDSTÜCK",
      value: `${listing.grundstuecksflaecheM2} m²`,
    },
    vw && { label: "VERKEHRSWERT", value: formatCurrency(vw) ?? "—" },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <PageShell compact>
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4 flex-wrap">
          <Link href="/" className="hover:text-primary">
            Deutschland
          </Link>
          <ChevronRight className="size-3.5" />
          <Link href={`/${bundesland}`} className="hover:text-primary">
            {bl?.name ?? bundesland}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground font-medium truncate">
            {azDisplay ?? listing.aktenzeichen}
          </span>
        </nav>

        {/* Banner für bereits versteigerte Objekte */}
        {isArchived && (
          <div className="mb-4 flex items-start gap-2 rounded-[4px] border border-[var(--warning)]/40 bg-[var(--warning-container)] text-[var(--warning-container-fg)] p-3 text-sm">
            <span className="text-base shrink-0">⚠️</span>
            <span>
              <strong>Dieses Objekt wurde bereits versteigert.</strong>
              {listing.terminDate && (
                <span className="ml-1 opacity-80">
                  (Termin: {formatDateTime(listing.terminDate)})
                </span>
              )}
              <span className="ml-1 opacity-80">
                Der Link im ZVG-Portal ist nicht mehr verfügbar.
              </span>
            </span>
          </div>
        )}

        {/* Bildergalerie */}
        {imageUrls.length === 0 && listing.source === "justizportal" ? (
          <div className="relative mb-3">
            <EmptyState
              message="Keine Bilder in der Akte. Quelle und Gutachten stehen unten."
              action={
                <a
                  href={justizUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-foreground hover:underline inline-flex items-center gap-1"
                >
                  Justizportal
                  <ExternalLink className="size-3" />
                </a>
              }
            />
            <div className="absolute top-2 right-2">
              <FavoriteButton listingId={listing.id} initialFavorited={isFavorited} />
            </div>
          </div>
        ) : (
          <GalleryHero
            images={imageUrls}
            listingId={listing.id}
            initialFavorited={isFavorited}
            className="mb-3"
          />
        )}
        <KeyFactsStrip facts={keyFacts} className="mb-3" />
        <TrustRow
          className="mb-6"
          items={[
            { label: "Quelle", value: listing.source ?? "—" },
            {
              label: "Stand",
              value: listing.lastSeenAt ? formatDate(listing.lastSeenAt) : "—",
            },
            { label: "Justizportal", value: "Akte öffnen", href: justizUrl },
          ]}
        />

        {/* 2-Spalten-Layout */}
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Linke Spalte: Hauptinhalt */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Titel */}
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-1">
                {listing.typ ?? "Immobilie"}
              </h1>
              <p className="text-muted-foreground flex items-center gap-1 mb-2">
                <MapPin className="size-3.5" />
                {listing.adresse ||
                  formatPlzOrt(listing.plz, listing.ort) ||
                  listing.bundeslandName}
              </p>
              {vw ? (
                <p className="text-3xl font-bold text-primary">{formatCurrency(vw)}</p>
              ) : (
                <p className="text-base text-muted-foreground italic">Verkehrswert nicht bekannt</p>
              )}
            </div>

            {/* Allgemeine Informationen */}
            <Card id="section-allgemeine-informationen">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Allgemeine Informationen</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2.5">
                  <Row label="Versteigerungsart" value="Zwangsvollstreckung" />
                  <Row label="Aktenzeichen" value={azDisplay ?? listing.aktenzeichen} />
                  <Row label="Adresse" value={listing.adresse} />
                  {listing.nutzflaecheM2 && (
                    <Row label="Nutzfläche" value={`${listing.nutzflaecheM2} m²`} />
                  )}
                  {listing.wohnflaecheM2 && (
                    <Row label="Wohnfläche" value={`${listing.wohnflaecheM2} m²`} />
                  )}
                  {listing.gesamtflaecheM2 && (
                    <Row label="Gesamtfläche" value={`${listing.gesamtflaecheM2} m²`} />
                  )}
                  {listing.zimmer && <Row label="Zimmer" value={String(listing.zimmer)} />}
                  {listing.etage != null && (
                    <Row
                      label="Etage"
                      value={listing.etage === 0 ? "Erdgeschoss" : `${listing.etage}. Obergeschoss`}
                    />
                  )}
                  {listing.baujahr && <Row label="Baujahr" value={String(listing.baujahr)} />}
                  {listing.grundstuecksflaecheM2 && (
                    <Row label="Grundstücksgröße" value={`${listing.grundstuecksflaecheM2} m²`} />
                  )}
                  {listing.miteigentumsanteil && (
                    <Row label="Miteigentumsanteil" value={listing.miteigentumsanteil} />
                  )}
                  {listing.sondereigentum && (
                    <Row label="Sondereigentum" value={listing.sondereigentum} />
                  )}

                  {listing.beschreibung && (
                    <>
                      <Separator />
                      <div className="flex gap-4">
                        <dt className="text-sm text-muted-foreground font-medium w-28 sm:w-44 shrink-0 break-words">
                          Beschreibung:
                        </dt>
                        <dd className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                          {listing.beschreibung}
                        </dd>
                      </div>
                    </>
                  )}

                  <Separator />
                  <div className="flex gap-4 items-baseline">
                    <dt className="text-sm font-medium text-muted-foreground w-28 sm:w-44 shrink-0 break-words">
                      Verkehrswert:
                    </dt>
                    <dd
                      className={
                        vw
                          ? "text-xl font-bold text-primary"
                          : "text-sm italic text-muted-foreground"
                      }
                    >
                      {vw ? formatCurrency(vw) : "Verkehrswert nicht bekannt"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Status-Boxen (Denkmalschutz / Vermietet) */}
            {(listing.denkmalschutz != null || listing.vermietet != null) && !ki && (
              <Card id="section-objektstatus">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Objektstatus</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {listing.denkmalschutz != null && (
                      <StatusBox
                        label="Denkmalschutz"
                        value={listing.denkmalschutz ? "Ja" : "Nein"}
                        variant={listing.denkmalschutz ? "amber" : "gray"}
                      />
                    )}
                    {listing.vermietet != null && (
                      <StatusBox
                        label="Vermietet"
                        value={listing.vermietet ? "Ja" : "Nein"}
                        variant={listing.vermietet ? "amber" : "green"}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KI-Sektionen */}
            {ki && (
              <>
                <GrundbuchSection
                  blatt={ki.grundbuchBlatt}
                  flurstueck={ki.grundbuchFlurstueck}
                  gemarkung={ki.grundbuchGemarkung}
                  flurstuecke={(ki.flurstuecke as any) ?? []}
                />
                <MaengelSection maengel={(ki.maengel as any) ?? []} />
                <BelastungenSection belastungen={(ki.belastungen as any) ?? []} />
                <BodenrichtwertSection
                  eurM2={ki.bodenrichtwertEurM2}
                  stichtag={ki.bodenrichtwertStichtag}
                  berechnung={ki.bodenrichtwertBerechnung}
                />
                <ModernisierungenSection modernisierungen={(ki.modernisierungen as any) ?? []} />
                {investmentMemo && (
                  <InvestmentMemoSection memo={investmentMemo} listingId={listing.id} />
                )}
                {kiIsFull ? (
                  <>
                    <InvestmentFixFlipSection
                      investmentScore={ki.investmentScore}
                      investmentScoreBegruendung={ki.investmentScoreBegruendung}
                      risikenInvestor={(ki.risikenInvestor as any) ?? []}
                      fixFlipMassnahmen={(ki.fixFlipMassnahmen as any) ?? []}
                      fixFlipWerteinschaetzung={ki.fixFlipWerteinschaetzung}
                      fixFlipGesamtkostenMinEur={ki.fixFlipGesamtkostenMinEur}
                      fixFlipGesamtkostenMaxEur={ki.fixFlipGesamtkostenMaxEur}
                      moeglicherKaltmiete={ki.moeglicherKaltmiete}
                      hausgeld={ki.hausgeld}
                      jahresrohertrag={ki.jahresrohertrag}
                      liegenschaftszinssatz={ki.liegenschaftszinssatz}
                      ertragswert={ki.ertragswert}
                      kaufpreisEur={kaufpreis?.eur}
                      kaufpreisLabel={kaufpreis?.label}
                      erwerbsnebenkostenEur={erwerbNachAnnahme?.gesamt}
                      arvMinEur={ki.arvMinEur}
                      arvMaxEur={ki.arvMaxEur}
                      arvBegruendung={ki.arvBegruendung}
                      arvKonfidenz={ki.arvKonfidenz}
                      flip={flipAusUnderwriting}
                      flipVorbehalt={flipVorbehalt}
                      financingRatePct={investorProfile.financingRatePct}
                    />
                    <BuyHoldCard
                      kaufpreisEur={kaufpreis?.eur ?? vw}
                      verkehrswertEur={vw}
                      kaufpreisLabel={kaufpreis?.label}
                      kiMieteSchaetzungEur={gutachtenmiete}
                      marktmieteEur={marktmiete}
                      hausgeldEur={ki.hausgeld}
                      wohnflaecheM2={listing.wohnflaecheM2}
                      bundesland={landSlug}
                    />
                  </>
                ) : (
                  <FullAnalyseCta
                    slug={listing.slug}
                    bundesland={landSlug}
                    initialTier={ki.analysisTier}
                    initialStatus={ki.fullStatus}
                  />
                )}
                <EnergieausweisSection
                  vorhanden={ki.energieausweisVorhanden}
                  effizienzklasse={ki.effizienzklasse}
                  ausweisjahr={ki.ausweisjahr}
                  energietraeger={ki.energietraeger}
                  endenergieverbrauchKwh={ki.endenergieverbrauchKwh}
                />
                <ObjektzustandSection
                  denkmalschutz={listing.denkmalschutz}
                  innenbesichtigung={ki.innenbesichtigung}
                  vermietet={listing.vermietet}
                  restnutzungsdauerJ={ki.restnutzungsdauerJ}
                  heizung={ki.heizung}
                  wohnraeume={ki.wohnraeume}
                  gebaeudenutzungen={(ki.gebaeudenutzungen as any) ?? []}
                  zustandAussen={ki.zustandAussen}
                  zustandInnen={ki.zustandInnen}
                  maengelKurz={ki.maengelKurz}
                />
                <BauInstandhaltungSection
                  baubeschreibung={ki.baubeschreibung}
                  instandhaltung={ki.instandhaltung}
                  baulasten={ki.baulasten}
                />
                <LageSection
                  einwohner={ki.lageEinwohner}
                  region={ki.lageRegion}
                  verkehr={ki.lageVerkehr}
                  charakter={ki.lageCharakter}
                  umgebung={ki.lageUmgebung}
                />
                <OrteInDerNaeheSection orte={(ki.orteInDerNaehe as any) ?? []} />
              </>
            )}

            {!ki && (
              <>
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center">
                    <p className="text-muted-foreground text-sm">{kiAnalysisEmptyCopy(listing)}</p>
                  </CardContent>
                </Card>
                <FullAnalyseCta
                  slug={listing.slug}
                  bundesland={landSlug}
                  initialTier={null}
                  initialStatus={null}
                />
              </>
            )}

            {/* Standort-Karte */}
            {coords || listing.adresse ? (
              <Card id="section-standort">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Standort</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {coords && (
                    <StandortMap
                      lat={coords.lat}
                      lng={coords.lng}
                      adresse={listing.adresse}
                      verkehrswert={vw}
                    />
                  )}
                  <MapLinks
                    lat={coords?.lat ?? null}
                    lng={coords?.lng ?? null}
                    adresse={listing.adresse}
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Rechte Sidebar */}
          <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
            {/* Verkehrswert + Bieterinfo */}
            {vw && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <Scale className="size-4 text-primary" /> Bietgrenzen
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-mono text-2xl font-bold text-primary mb-4">
                    {formatCurrency(vw)}
                  </div>
                  <BietergrenzeBar
                    verkehrswert={vw}
                    geringstesGebot={terminsdaten.geringstesGebotEur}
                  />
                  <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                    Die 5/10-Regelung: Unter 70 % kann der Gläubiger widersprechen, unter 50 % ist
                    das Gebot unzulässig (§ 85a ZVG).
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Gerichtsinformationen */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-1.5">
                  <Building2 className="size-4 text-muted-foreground" /> Gerichtsinformationen
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Amtsgericht</dt>
                    <dd className="font-medium flex items-center gap-1.5 flex-wrap">
                      {amtsgerichtDisplay ?? (
                        <span className="text-muted-foreground italic">
                          {listing.bundeslandName}
                        </span>
                      )}
                      {isDirectlinkUsable(direktlinkFixed, listing.source) ? (
                        <a
                          href={direktlinkFixed!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs font-normal inline-flex items-center gap-0.5"
                        >
                          Direkt zur Quelle
                          <ExternalLink className="size-2.5" />
                        </a>
                      ) : (
                        <a
                          href={justizUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary hover:underline text-xs font-normal inline-flex items-center gap-0.5"
                        >
                          Im Justizportal suchen
                          <ExternalLink className="size-2.5" />
                        </a>
                      )}
                    </dd>
                  </div>
                  {listing.versteigerungsort && (
                    <div>
                      <dt className="text-muted-foreground text-xs">Versteigerungsort</dt>
                      <dd className="font-medium">{listing.versteigerungsort}</dd>
                    </div>
                  )}
                  {listing.terminDate && (
                    <div>
                      <dt className="text-muted-foreground text-xs">Termin</dt>
                      <dd className="font-semibold text-primary">
                        {formatDateTime(listing.terminDate)}
                      </dd>
                    </div>
                  )}
                  {listing.terminSaal && (
                    <div>
                      <dt className="text-muted-foreground text-xs">Saal</dt>
                      <dd className="font-medium">{listing.terminSaal}</dd>
                    </div>
                  )}
                </dl>

                {googleCalUrl &&
                  outlookCalUrl &&
                  calendarTitle &&
                  listing.terminDate &&
                  !isArchived && (
                    <CalendarActions
                      googleUrl={googleCalUrl}
                      outlookUrl={outlookCalUrl}
                      filename={`versteigerung-${slug}.ics`}
                      ics={{
                        title: calendarTitle,
                        terminDate: listing.terminDate.toISOString(),
                        location: calendarLocation,
                        description: calendarBody,
                        uid: `zvg-${listing.id}@${siteIdDomain()}`,
                      }}
                    />
                  )}
              </CardContent>
            </Card>

            {/* Dokumente */}
            {(gutachtenHref || exposeHref) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <FileText className="size-4 text-muted-foreground" /> Dokumente
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Intern gespeichert. Nur mit Anmeldung. Vor dem Gebot selbst prüfen.
                  </p>
                  {gutachtenHref && (
                    <Button variant="outline" className="w-full" asChild>
                      <a href={gutachtenHref} target="_blank" rel="noopener noreferrer">
                        <Download data-icon="inline-start" />
                        Gutachten (PDF)
                      </a>
                    </Button>
                  )}
                  {exposeHref && (
                    <Button variant="outline" className="w-full" asChild>
                      <a href={exposeHref} target="_blank" rel="noopener noreferrer">
                        <Download data-icon="inline-start" />
                        Exposé (PDF)
                      </a>
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Erwerbsgebühren */}
            {erwerb && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Erwerbsgebühren</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Berechnet auf Basis des Verkehrswerts
                  </p>
                </CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Grundbucheintrag</dt>
                      <dd className="font-medium">{formatCurrency(erwerb.grundbucheintrag)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        Grunderwerbsteuer ({(erwerb.grunderwerbsteuerRate * 100).toFixed(1)} %)
                      </dt>
                      <dd className="font-medium">{formatCurrency(erwerb.grunderwerbsteuer)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Zuschlagsgebühr</dt>
                      <dd className="font-medium">{formatCurrency(erwerb.zuschlagsgebuehr)}</dd>
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                      <dt className="font-semibold text-foreground">Gesamt Nebenkosten</dt>
                      <dd className="font-bold text-primary">{formatCurrency(erwerb.gesamt)}</dd>
                    </div>
                  </dl>
                  <Button variant="outline" size="sm" className="w-full mt-3" asChild>
                    <Link
                      href={`/rechner?verkehrswert=${listing.verkehrswert}&versteigerungswert=${kaufpreis?.eur ?? listing.verkehrswert}&bundesland=${landSlug}`}
                    >
                      Detaillierter Kostenrechner
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Direktlink-Box */}
            {isArchived ? (
              <Card className="border-[var(--warning)]/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <Info className="size-4 text-muted-foreground" /> Originalquelle
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-[var(--warning-container-fg)]">
                    ✓ Versteigerung abgeschlossen
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Das Objekt wurde versteigert. Der Eintrag im ZVG-Portal ist nicht mehr
                    verfügbar.
                  </p>
                  <Button variant="outline" className="w-full" asChild>
                    <a href={justizUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4 mr-1.5" />
                      Neue Termine im Bundesland suchen
                    </a>
                  </Button>
                </CardContent>
              </Card>
            ) : isDirectlinkUsable(direktlinkFixed, listing.source) ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <Info className="size-4 text-muted-foreground" /> Originalquelle
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="default" className="w-full" asChild>
                    <a href={direktlinkFixed!} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4 mr-1.5" />
                      Direkt zum Originalobjekt
                    </a>
                  </Button>
                </CardContent>
              </Card>
            ) : listing.aktenzeichen ? (
              <Card className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <Info className="size-4 text-muted-foreground" /> Originalquelle
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    {listing.source === "justizportal"
                      ? "Suche im Bundesland-Portal nach dem Aktenzeichen:"
                      : "Kein Direktlink verfügbar. Mit Aktenzeichen im Justizportal suchen:"}
                  </p>
                  <Button variant="outline" className="w-full" asChild>
                    <a href={justizUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4 mr-1.5" />
                      Im Justizportal suchen
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground text-center font-mono">
                    {azDisplay ?? listing.aktenzeichen}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed border-destructive/30">
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground text-center">
                    Keine Quellenangabe verfügbar
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </PageShell>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-4">
      {/* break-words: einzelne lange, unteilbare Labels (z.B. "Grundstücksgröße")
          würden sonst bei w-28 über den Rand hinaus in den Wert hineinlaufen,
          statt in der schmaleren Spalte umzubrechen. */}
      <dt className="text-sm text-muted-foreground font-medium w-28 sm:w-44 shrink-0 break-words">
        {label}:
      </dt>
      <dd className="text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function StatusBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: "green" | "amber" | "red" | "gray";
}) {
  const styles = {
    green:
      "bg-[var(--success-container)] text-[var(--success-container-fg)] border-[var(--success)]/30",
    amber:
      "bg-[var(--warning-container)] text-[var(--warning-container-fg)] border-[var(--warning)]/30",
    red: "bg-[var(--error-container)] text-[var(--error-container-fg)] border-[var(--destructive)]/30",
    gray: "bg-muted/50 text-foreground border-border",
  };
  return (
    <div className={cn("border rounded-[4px] p-3 text-center", styles[variant])}>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
