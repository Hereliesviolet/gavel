import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { berechneErwerbskosten, formatPlzOrt, hatDeutscheGrunderwerbsteuer } from "@/lib/utils";

describe("Custom-URL-Analyse-Seite", () => {
  const src = readFileSync(path.join(__dirname, "../../app/analyse/[listingId]/page.tsx"), "utf8");
  const buyHold = readFileSync(
    path.join(__dirname, "../../components/zvg/detail/ki-sections/buy-hold.tsx"),
    "utf8",
  );
  const standort = readFileSync(
    path.join(__dirname, "../../components/zvg/detail/standort-map.tsx"),
    "utf8",
  );

  it("rechnet Flip und Buy&Hold nur für Kaufangebote", () => {
    expect(src).toContain('const istKauf = listing.angebotstyp === "kauf"');
    expect(src).toContain("hatDeutscheGrunderwerbsteuer(bundesland)");
    expect(src).toContain("const kaufpreisAnnahme = istKauf ? kaufpreisAusAngebot(preis) : null");
    expect(src).toContain("{istKauf && (");
    expect(src).toContain("kaufpreisEur={kaufpreisAnnahme?.eur}");
    expect(src).toContain("{istKauf && ki.renditeGeschaetztPct != null && (");
    expect(src).toContain("{istKauf && ki.cashflowEinschaetzung && (");
  });

  it("vergleicht die Marktlücke nur mit der passenden Angebotsart", () => {
    expect(src).toContain('listing.angebotstyp === "miete"');
    expect(src).toContain('listing.angebotstyp === "kauf"');
    expect(src).toContain("? marktreferenzKauf");
    expect(src).toContain(": null");
  });

  it("zeigt die Karte mit Angebotspreis statt Verkehrswert", () => {
    expect(src).toContain("priceLabel={");
    expect(src).toContain('"Angebotspreis"');
    expect(src).toContain('"Kaltmiete"');
    expect(standort).toContain('priceLabel = "Verkehrswert"');
  });

  it("erlaubt Unlink für Einreicher und eigenen Erfolg, nicht nur Owner", () => {
    expect(src).toContain("kannEntfernen");
    expect(src).toContain('customUrlRequests.status, "success"');
  });

  it("setzt Buy&Hold-Nebenkosten nur bei bekannter deutscher GrESt", () => {
    expect(buyHold).toContain("hatDeutscheGrunderwerbsteuer(bundesland)");
    expect(buyHold).not.toContain('bundesland ?? "unbekannt"');
  });

  it("schreibt fehlenden Ort nicht als Literal null in die Adresszeile", () => {
    expect(formatPlzOrt("80331", null)).toBe("80331");
    expect(formatPlzOrt("80331", undefined)).toBe("80331");
    expect(formatPlzOrt(null, "Berlin")).toBe("Berlin");
    expect(formatPlzOrt("80331", "München")).toBe("80331 München");
    expect(formatPlzOrt(null, null)).toBe("");
    expect(src).toContain("formatPlzOrt(listing.plz, listing.ort)");
    expect(src).not.toContain("`${listing.plz} ${listing.ort}`");
    const zvgDetail = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/[slug]/page.tsx"),
      "utf8",
    );
    expect(zvgDetail).toContain("formatPlzOrt(listing.plz, listing.ort)");
    expect(zvgDetail).not.toContain("`${listing.plz} ${listing.ort}`");
    expect(zvgDetail).toContain('listing.ort ? ` in ${listing.ort}` : ""');
    expect(zvgDetail).not.toContain('`${listing.typ ?? "Immobilie"} in ${listing.ort}`');
  });

  it("beschriftet Buy&Hold-Break-even mit demselben 1-basierten Jahr wie die Tabelle", () => {
    expect(buyHold).toContain("`Jahr ${jahr + 1}`");
    expect(buyHold).toContain("{j.jahr + 1}");
    expect(buyHold).not.toContain("Jahr 0 (sofort)");
  });

  it("zählt Mietfavoriten nicht in die VW-Summe und kennzeichnet sie", () => {
    const favoritenPage = readFileSync(
      path.join(__dirname, "../../app/favoriten/page.tsx"),
      "utf8",
    );
    const favoritenClient = readFileSync(
      path.join(__dirname, "../../app/favoriten/client.tsx"),
      "utf8",
    );
    expect(favoritenPage).toContain('r.angebotstyp === "miete" ? "Miete" : "Markt"');
    expect(favoritenPage).toContain('preisIstMonatlich: r.angebotstyp === "miete"');
    expect(favoritenClient).toContain('if (f.angebotstyp === "miete") return s');
    expect(favoritenClient).toContain("listingType={f.kind}");
    expect(favoritenClient).toContain("function timeMs(");
    expect(favoritenClient).toContain("timeMs(b.addedAt)");
    expect(favoritenClient).not.toContain("b.addedAt.getTime()");
    expect(favoritenPage).toContain("offline: r.istAktiv === false");
    const card = readFileSync(
      path.join(__dirname, "../../components/zvg/listing-card.tsx"),
      "utf8",
    );
    expect(card).toContain("preisIstMonatlich");
    expect(card).toContain(" / Mo.");
    expect(card).toContain("listing.offline");
    expect(card).toContain("listingType={listingType}");
    expect(favoritenPage).toContain("istAktiv: zvgListings.istAktiv");
  });

  it("beschriftet den Detailpreis bei Miete als Monatswert", () => {
    expect(src).toContain('listing.angebotstyp === "miete" ? "MIETE/M²" : "PREIS/M²"');
    expect(src).toContain("/ Monat");
  });

  it("blendet Investment-Preview und Flip-Sektion bei Miete aus", () => {
    const preview = readFileSync(
      path.join(__dirname, "../../components/analyse/analyse-preview.tsx"),
      "utf8",
    );
    expect(preview).toContain('preview.angebotstyp === "kauf"');
    expect(preview).toContain('preview.investmentScore && preview.angebotstyp === "kauf"');
    expect(src).toContain("{istKauf && (");
    expect(src).toContain("<InvestmentFixFlipSection");
    expect(src).toContain("getInvestorProfile(session.user.id)");
    expect(src).toMatch(/\},\s*profile,?\s*\)/);
    expect(src).toContain("financingRatePct={profile.financingRatePct}");
    const fixFlip = readFileSync(
      path.join(__dirname, "../../components/zvg/detail/ki-sections/investment-fixflip.tsx"),
      "utf8",
    );
    expect(fixFlip).toContain("financingRatePct ?? DEFAULT_INVESTOR_PROFILE.financingRatePct");
    expect(fixFlip).not.toContain("Finanzierung 4,5 %");
    const zvgDetail = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/[slug]/page.tsx"),
      "utf8",
    );
    expect(zvgDetail).toContain("financingRatePct={investorProfile.financingRatePct}");
    expect(zvgDetail).toContain(
      "verkehrswert=${listing.verkehrswert}&versteigerungswert=${kaufpreis?.eur ?? listing.verkehrswert}",
    );
    expect(zvgDetail).toContain("berechneErwerbskosten(vw, kaufpreis?.eur ?? vw, landSlug)");
    expect(zvgDetail).toContain("verkehrswertEur={vw}");
    expect(buyHold).toContain("verkehrswertInitial ?? kaufpreisInitial");
    expect(buyHold).toContain("verkehrswertInitial ?? kaufpreis");
    expect(berechneErwerbskosten(300_000, 210_000, "bayern").verzinsung).toBeGreaterThan(0);
    expect(berechneErwerbskosten(210_000, 210_000, "bayern").verzinsung).toBe(0);
  });

  it("lädt Analyse-Bilder im Browser mit Session, nicht über den Image-Optimizer", () => {
    const gallery = readFileSync(
      path.join(__dirname, "../../components/zvg/detail/gallery-hero.tsx"),
      "utf8",
    );
    const card = readFileSync(
      path.join(__dirname, "../../components/zvg/listing-card.tsx"),
      "utf8",
    );
    expect(gallery).toContain("listingImageNeedsBrowserCookies");
    expect(gallery).toContain("unoptimized={listingImageNeedsBrowserCookies(");
    expect(card).toContain("unoptimized={listingImageNeedsBrowserCookies(coverSrc)}");
  });

  it("kennzeichnet offline gegangene Angebote", () => {
    expect(src).toContain("listing.istAktiv === false");
    expect(src).toContain("Dieses Angebot ist nicht mehr online.");
    const route = readFileSync(
      path.join(__dirname, "../../app/api/analyse/[listingId]/route.ts"),
      "utf8",
    );
    expect(route).toContain(
      "omitPurchaseUnderwriting(omitKiInternals(analyse), listing.angebotstyp)",
    );
  });
});

describe("hatDeutscheGrunderwerbsteuer", () => {
  it("lehnt unbekannte und fehlende Länder ab", () => {
    expect(hatDeutscheGrunderwerbsteuer("bayern")).toBe(true);
    expect(hatDeutscheGrunderwerbsteuer("unbekannt")).toBe(false);
    expect(hatDeutscheGrunderwerbsteuer(undefined)).toBe(false);
    expect(berechneErwerbskosten(100_000, 100_000, "bayern").gesamt).toBeGreaterThan(0);
  });

  it("nutzt die gesetzlichen Sätze 2026 für Sachsen, Thüringen und Bremen", () => {
    expect(berechneErwerbskosten(200_000, 200_000, "sachsen").grunderwerbsteuerRate).toBe(0.055);
    expect(berechneErwerbskosten(200_000, 200_000, "thueringen").grunderwerbsteuerRate).toBe(0.05);
    expect(berechneErwerbskosten(200_000, 200_000, "bremen").grunderwerbsteuerRate).toBe(0.055);
    expect(berechneErwerbskosten(200_000, 200_000, "sachsen").grunderwerbsteuer).toBe(11_000);
    expect(berechneErwerbskosten(200_000, 200_000, "thueringen").grunderwerbsteuer).toBe(10_000);
    expect(berechneErwerbskosten(200_000, 200_000, "bremen").grunderwerbsteuer).toBe(11_000);
  });
});
