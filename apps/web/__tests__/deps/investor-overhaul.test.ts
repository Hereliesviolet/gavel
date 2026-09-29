import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPeerBenchmark, computeBenchmarkDiscountPct } from "@/lib/investor-benchmarks";
import { isMissingInvestorProfileRelation, normalizeInvestorProfile } from "@/lib/investor-profile";
import { evaluateInvestorQuality } from "@/lib/investor-quality";
import {
  acquisitionCostsForBid,
  calculateInvestmentUnderwriting,
  flipKennzahlen,
} from "@/lib/underwriting";
import { berechneErwerbskosten } from "@/lib/utils";
import { buildInvestmentMemo } from "@/lib/investor-memo";
import { aggregateInvestorQuality } from "@/lib/investor-monitoring";
import type { ChanceErgebnis } from "@/lib/investor-signals";
import { berechneBuyHoldProjektion } from "@/lib/underwriting";
import { startOfZonedDay } from "@/lib/utils";

const futureDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date;
};

const reliableBenchmark = buildPeerBenchmark({
  medianEurM2: 2_500,
  p25EurM2: 2_200,
  p75EurM2: 2_900,
  sampleSize: 20,
});

function validQualityInput() {
  return {
    listing: {
      verkehrswert: 200_000,
      wohnflaecheM2: 80,
      terminDate: futureDate(),
      needsReview: false,
      dataQualityFlags: [],
    },
    ki: {
      moeglicherKaltmiete: 1_200,
      hausgeld: 300,
      fixFlipMassnahmen: [{ beschreibung: "Bad sanieren" }],
      fixFlipGesamtkostenMinEur: 25_000,
      fixFlipGesamtkostenMaxEur: 40_000,
      arvMinEur: 280_000,
      arvMaxEur: 320_000,
      arvKonfidenz: "mittel",
      innenbesichtigung: true,
      risikenInvestor: [],
    },
    // Kommt aus dem Underwriting, nicht mehr aus der Datenbank.
    flip: { roiPctMin: 8, roiPctMax: 20, einschaetzung: "attraktiv" },
    preisProM2: 2_000,
    benchmark: reliableBenchmark,
  };
}

describe("peer benchmarks", () => {
  it("stuft eine einzelne Vergleichsbeobachtung als unzureichend ein", () => {
    const benchmark = buildPeerBenchmark({
      medianEurM2: 1_500,
      sampleSize: 1,
    });
    expect(benchmark.sufficient).toBe(false);
    expect(benchmark.confidence).toBe("insufficient");
    expect(computeBenchmarkDiscountPct(1_000, benchmark)).toBeNull();
  });

  it("liefert ab zehn Peers einen belastbaren Benchmark", () => {
    const benchmark = buildPeerBenchmark({
      medianEurM2: 2_000,
      sampleSize: 10,
    });
    expect(benchmark.reliable).toBe(true);
    expect(benchmark.confidence).toBe("medium");
    expect(computeBenchmarkDiscountPct(1_500, benchmark)).toBe(25);
  });
});

describe("investor quality gates", () => {
  it("blockiert needsReview unabhängig von vorhandenen Scores", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      listing: { ...input.listing, needsReview: true },
    });
    expect(result.status).toBe("needs_review");
    expect(result.eligibility.buyHold).toBe(false);
    expect(result.eligibility.fixFlip).toBe(false);
  });

  it("blockiert einen Verkehrswert von einem Euro", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      listing: { ...input.listing, verkehrswert: 1 },
    });
    expect(result.status).toBe("needs_review");
    expect(result.blockers).toContain("Keine belastbare Kaufpreis-/Verkehrswertbasis.");
  });

  it("bewertet Buy & Hold ohne Miete nicht als eligible", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: { ...input.ki, moeglicherKaltmiete: null },
    });
    expect(result.eligibility.buyHold).toBe(false);
    expect(result.eligibility.fixFlip).toBe(true);
  });

  it("nimmt Buy & Hold über die angezeigte Marktmiete an", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: { ...input.ki, moeglicherKaltmiete: null },
      monthlyRentEur: 1_200,
    });
    expect(result.eligibility.buyHold).toBe(true);
  });

  it("nimmt Unter-Markt über die Marktlücke an, auch ohne Peer-Abschlag", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      benchmark: buildPeerBenchmark({ sampleSize: 0, scope: "none" }),
      marktlueckePct: 12,
    });
    expect(result.eligibility.unterMarkt).toBe(true);
  });

  it("fällt bei fehlender Marktlücke auf den Peer-Abschlag zurück", () => {
    const input = validQualityInput();
    const withPeer = evaluateInvestorQuality({
      ...input,
      marktlueckePct: null,
    });
    expect(withPeer.eligibility.unterMarkt).toBe(true);

    const overpriced = evaluateInvestorQuality({
      ...input,
      marktlueckePct: -8,
    });
    expect(overpriced.eligibility.unterMarkt).toBe(false);
  });

  it("blockiert Flip mit niedriger ARV-Konfidenz", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: { ...input.ki, arvKonfidenz: "niedrig" },
    });
    expect(result.eligibility.fixFlip).toBe(false);
  });

  it("blockiert Flip ohne belastbares Sanierungskostenintervall", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: {
        ...input.ki,
        fixFlipGesamtkostenMinEur: null,
        fixFlipGesamtkostenMaxEur: null,
      },
    });
    expect(result.eligibility.fixFlip).toBe(false);
    expect(result.warnings.join(" ")).toContain("Sanierungsumfang");
  });

  it("blockiert kritische Rechte und Transaktionsrisiken strategieübergreifend", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: {
        ...input.ki,
        risikenInvestor: ["Versteigert wird nur ein 1/2 Miteigentumsanteil"],
      },
    });
    expect(result.status).toBe("needs_review");
    expect(result.riskAssessment.critical).toHaveLength(1);
    expect(result.eligibility.buyHold).toBe(false);
    expect(result.eligibility.fixFlip).toBe(false);
    expect(result.eligibility.unterMarkt).toBe(false);
  });

  it("verlangt ohne Innenbesichtigung eine konservative Sanierungsreserve", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: {
        ...input.ki,
        innenbesichtigung: false,
        fixFlipGesamtkostenMaxEur: 20_000,
        risikenInvestor: ["Keine Innenbesichtigung möglich"],
      },
    });
    expect(result.eligibility.fixFlip).toBe(false);
    expect(result.warnings.join(" ")).toContain("500 €/m²");
  });

  it("wertet einen Preisabschlag ohne tragfähige Strategie nicht positiv", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: { ...input.ki, moeglicherKaltmiete: null },
      flip: { roiPctMin: -15, roiPctMax: -5, einschaetzung: "abraten" },
    });
    expect(result.eligibility.unterMarkt).toBe(false);
    expect(result.eligibility.reasons.join(" ")).toContain("widersprochen");
  });

  it("blockiert einen extremen ARV-Ausreißer", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: { ...input.ki, arvMinEur: 5_000_000, arvMaxEur: 6_000_000 },
    });
    expect(result.eligibility.fixFlip).toBe(false);
    expect(result.warnings.join(" ")).toContain("ARV");
  });

  it("markiert veraltete Analysen und schaltet Empfehlungen ab", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: { ...input.ki, analyzedAt: "2020-01-01T00:00:00.000Z" },
      now: new Date("2026-07-24T00:00:00.000Z"),
    });
    expect(result.status).toBe("stale");
    expect(result.eligibility.buyHold).toBe(false);
    expect(result.eligibility.fixFlip).toBe(false);
  });

  it("erlaubt alle Strategien bei konsistenten Daten", () => {
    const result = evaluateInvestorQuality(validQualityInput());
    expect(result.status).toBe("ready");
    expect(result.eligibility).toMatchObject({
      buyHold: true,
      fixFlip: true,
      unterMarkt: true,
      zeitnah: true,
    });
  });

  it("macht aus einem nahen Termin allein keine Investment-Bewertbarkeit", () => {
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      ki: {
        ...input.ki,
        moeglicherKaltmiete: null,
        fixFlipMassnahmen: [],
        fixFlipGesamtkostenMinEur: null,
        fixFlipGesamtkostenMaxEur: null,
        arvMinEur: null,
        arvMaxEur: null,
      },
      benchmark: buildPeerBenchmark({ sampleSize: 0, scope: "none" }),
    });
    expect(result.eligibility.zeitnah).toBe(true);
    expect(result.status).not.toBe("ready");
  });

  it("hält date-only Termine am Auktionstag zeitnah", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const input = validQualityInput();
    const result = evaluateInvestorQuality({
      ...input,
      listing: { ...input.listing, terminDate: startOfZonedDay(now) },
      now,
    });
    expect(result.eligibility.zeitnah).toBe(true);
  });
});

describe("investor profile", () => {
  it("begrenzt ungültige Werte auf sichere Bereiche", () => {
    const profile = normalizeInvestorProfile({
      financingRatePct: 999,
      equityPct: -5,
      minDscr: Number.NaN,
      strategies: [] as never[],
    });
    expect(profile.financingRatePct).toBe(30);
    expect(profile.equityPct).toBe(0);
    expect(profile.minDscr).toBe(1.2);
    expect(profile.strategies.length).toBeGreaterThan(0);
  });

  it("behält nur bekannte Bundesland-Slugs und Kategorien", () => {
    const profile = normalizeInvestorProfile({
      regions: ["nordrhein-westfalen", "Narnia", "Bayern"],
      propertyTypes: ["wohnung", "villa", "haus"],
    });
    expect(profile.regions).toEqual(["nordrhein-westfalen", "bayern"]);
    expect(profile.propertyTypes).toEqual(["wohnung", "haus"]);
  });

  it("erkennt fehlende Profil-Tabelle, nicht beliebige DB-Fehler", () => {
    expect(isMissingInvestorProfileRelation({ code: "42P01" })).toBe(true);
    expect(
      isMissingInvestorProfileRelation({
        message: "connect ECONNREFUSED",
        cause: { code: "42P01", message: "relation investor_profiles does not exist" },
      }),
    ).toBe(true);
    expect(isMissingInvestorProfileRelation({ message: "connect ECONNREFUSED 5432" })).toBe(false);
    const storage = readFileSync(
      path.join(__dirname, "../../lib/investor-profile-storage.ts"),
      "utf8",
    );
    expect(storage).toContain("if (isMissingInvestorProfileRelation(error))");
    expect(storage).toContain("throw error");
    expect(storage).not.toContain('Fallback auf Standardprofil", error');
  });
});

describe("underwriting", () => {
  const inputs = {
    purchasePriceEur: 200_000,
    acquisitionCostsEur: 14_000,
    monthlyRentEur: 1_400,
    monthlyHausgeldEur: 300,
    livingAreaM2: 80,
    renovationMinEur: 25_000,
    renovationMaxEur: 40_000,
    arvMinEur: 300_000,
    arvMaxEur: 340_000,
    holdingMonths: 9,
  };

  it("erzeugt Bear/Base/Bull deterministisch", () => {
    const result = calculateInvestmentUnderwriting(inputs);
    expect(result.buyHold.map((item) => item.name)).toEqual(["bear", "base", "bull"]);
    expect(result.fixFlip.map((item) => item.name)).toEqual(["bear", "base", "bull"]);
    expect(result.version).toBe("underwriting-v3-ein-modell");
  });

  it("macht den Bear Case konservativer als den Bull Case", () => {
    const result = calculateInvestmentUnderwriting(inputs);
    expect(result.buyHold[0].cashflowBeforeTaxEur).toBeLessThan(
      result.buyHold[2].cashflowBeforeTaxEur,
    );
    expect(result.fixFlip[0].profitEur).toBeLessThan(result.fixFlip[2].profitEur);
  });

  it("liefert Maximalgebote statt nur eines Scores", () => {
    const result = calculateInvestmentUnderwriting(inputs);
    expect(result.buyHold[1].maxBidEur).toBeGreaterThan(0);
    expect(result.fixFlip[1].maxBidEur).toBeGreaterThan(0);
  });

  it("begrenzt Maximalgebote durch das verfügbare Eigenkapital", () => {
    const result = calculateInvestmentUnderwriting(inputs, {
      maxEquityEur: 20_000,
      equityPct: 20,
    });
    expect(result.buyHold[1].maxBidEur).toBeLessThanOrEqual(100_000);
    expect(result.fixFlip[1].maxBidEur).toBeLessThan(inputs.purchasePriceEur);
  });

  it("erzeugt ohne Miete keine Buy-Hold-Szenarien", () => {
    const result = calculateInvestmentUnderwriting({
      ...inputs,
      monthlyRentEur: null,
    });
    expect(result.buyHold).toEqual([]);
    expect(result.fixFlip).toHaveLength(3);
  });

  it("erzeugt eine transparente Gebotskurve relativ zum gerichtlichen Verkehrswert", () => {
    const result = calculateInvestmentUnderwriting({
      ...inputs,
      purchasePriceEur: 140_000,
      acquisitionCostsEur: 10_000,
      courtValueEur: 200_000,
      referenceBidPct: 70,
      auctionTermsVerified: false,
      unknownCostItems: ["Bestehenbleibende Rechte"],
    });
    expect(result.referenceBidEur).toBe(140_000);
    expect(result.referenceBidPct).toBe(70);
    expect(result.provisional).toBe(true);
    expect(result.bidCurve.map((row) => row.bidPct)).toEqual([50, 60, 70, 80, 100]);
    expect(result.unknownCostItems).toContain("Bestehenbleibende Rechte");
  });

  it("skaliert ZVG-Nebenkosten nicht linear — Verzinsung ist affin zum Gebot", () => {
    const court = 300_000;
    const ref = 210_000;
    const land = "nordrhein-westfalen";
    const acqRef = berechneErwerbskosten(court, ref, land).gesamt;
    const zvgInputs = {
      purchasePriceEur: ref,
      acquisitionCostsEur: acqRef,
      courtValueEur: court,
      bundesland: land,
    };
    expect(acquisitionCostsForBid(zvgInputs, 150_000)).toBe(
      berechneErwerbskosten(court, 150_000, land).gesamt,
    );
    expect(acquisitionCostsForBid(zvgInputs, 300_000)).toBe(
      berechneErwerbskosten(court, 300_000, land).gesamt,
    );
    expect(acquisitionCostsForBid(zvgInputs, 300_000)).not.toBe(
      Math.round(300_000 * (acqRef / ref)),
    );
    expect(acquisitionCostsForBid({ ...zvgInputs, bundesland: null }, 300_000)).toBeCloseTo(
      300_000 * (acqRef / ref),
      5,
    );
  });

  it("beschriftet die Flip-Haltedauer als Spanne aus Bull- und Bear-Monaten", () => {
    const flip = flipKennzahlen(calculateInvestmentUnderwriting(inputs));
    expect(flip?.haltedauerMonateMin).toBe(8);
    expect(flip?.haltedauerMonateMax).toBe(12);
    expect(flip?.begruendung).toContain("8–12 Monate");
    const ui = readFileSync(
      path.join(__dirname, "../../components/zvg/detail/ki-sections/investment-fixflip.tsx"),
      "utf8",
    );
    expect(ui).toContain("formatHoldingMonths(holdingMonateMin, holdingMonateMax, holdingMonate)");
    const picks = readFileSync(path.join(__dirname, "../../lib/investor-picks.ts"), "utf8");
    expect(picks).toContain("bundesland,");
    const zvgDetail = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/[slug]/page.tsx"),
      "utf8",
    );
    expect(zvgDetail).toContain("bundesland: landSlug");
  });
});

describe("investment memo", () => {
  it("übernimmt die Underwriting-Miete in die Qualitätsprüfung", () => {
    const qualityInput = validQualityInput();
    const memo = buildInvestmentMemo({
      qualityInput: {
        ...qualityInput,
        ki: { ...qualityInput.ki, moeglicherKaltmiete: null },
      },
      underwritingInput: {
        purchasePriceEur: 200_000,
        acquisitionCostsEur: 14_000,
        monthlyRentEur: 1_400,
        monthlyHausgeldEur: 300,
      },
      benchmark: reliableBenchmark,
    });
    expect(memo.quality.eligibility.buyHold).toBe(true);
  });

  it("erzeugt bei Datenblockern keine positive Entscheidung", () => {
    const qualityInput = validQualityInput();
    const memo = buildInvestmentMemo({
      qualityInput: {
        ...qualityInput,
        listing: { ...qualityInput.listing, needsReview: true },
      },
      underwritingInput: {
        purchasePriceEur: 200_000,
        acquisitionCostsEur: 14_000,
        monthlyRentEur: 1_200,
      },
      investmentScore: "attraktiv",
      benchmark: reliableBenchmark,
    });
    expect(memo.decision).toBe("nicht_bewertbar");
    expect(memo.maxBidEur).toBeNull();
  });

  it("enthält Due-Diligence-Schritte und versionierte Berechnung", () => {
    const memo = buildInvestmentMemo({
      qualityInput: validQualityInput(),
      underwritingInput: {
        purchasePriceEur: 200_000,
        acquisitionCostsEur: 14_000,
        monthlyRentEur: 1_400,
        monthlyHausgeldEur: 300,
        livingAreaM2: 80,
        renovationMinEur: 20_000,
        renovationMaxEur: 30_000,
        arvMinEur: 300_000,
        arvMaxEur: 340_000,
        holdingMonths: 9,
      },
      investmentScore: "neutral",
      investmentReason: "Solide Mikrolage, Annahmen verifizieren.",
      risks: ["Innenbesichtigung fehlt"],
      benchmark: reliableBenchmark,
    });
    expect(memo.dueDiligence.length).toBeGreaterThanOrEqual(4);
    expect(memo.killCriteria).toContain("Innenbesichtigung fehlt");
    expect(memo.underwriting.version).toBe("underwriting-v3-ein-modell");
  });

  it("scheidet einen tragfähigen Flip nicht wegen schwachem Buy-&-Hold aus", () => {
    const memo = buildInvestmentMemo({
      qualityInput: {
        ...validQualityInput(),
        ki: { ...validQualityInput().ki, moeglicherKaltmiete: 350, hausgeld: 280 },
      },
      underwritingInput: {
        purchasePriceEur: 200_000,
        acquisitionCostsEur: 14_000,
        monthlyRentEur: 350,
        monthlyHausgeldEur: 280,
        livingAreaM2: 80,
        renovationMinEur: 20_000,
        renovationMaxEur: 30_000,
        arvMinEur: 420_000,
        arvMaxEur: 460_000,
        holdingMonths: 9,
      },
      investmentScore: "neutral",
      benchmark: reliableBenchmark,
    });
    const baseFlip = memo.underwriting.fixFlip.find((row) => row.name === "base");
    const baseHold = memo.underwriting.buyHold.find((row) => row.name === "base");
    expect(memo.quality.eligibility.fixFlip).toBe(true);
    expect(baseFlip?.marginOnCostPct).toBeGreaterThan(0);
    expect(baseHold?.dscr ?? 0).toBeLessThan(1);
    expect(memo.decision).not.toBe("ausscheiden");
    expect(memo.decision).toBe("weiter_pruefen");
  });

  it("scheidet aus, wenn die KI abrät", () => {
    const memo = buildInvestmentMemo({
      qualityInput: validQualityInput(),
      underwritingInput: {
        purchasePriceEur: 200_000,
        acquisitionCostsEur: 14_000,
        monthlyRentEur: 1_400,
        monthlyHausgeldEur: 300,
        livingAreaM2: 80,
        renovationMinEur: 20_000,
        renovationMaxEur: 30_000,
        arvMinEur: 420_000,
        arvMaxEur: 460_000,
        holdingMonths: 9,
      },
      investmentScore: "abraten",
      benchmark: reliableBenchmark,
    });
    expect(memo.decision).toBe("ausscheiden");
  });

  it("leitet das globale Maximalgebot nur aus gewählten Strategien ab", () => {
    const memo = buildInvestmentMemo({
      qualityInput: validQualityInput(),
      underwritingInput: {
        purchasePriceEur: 200_000,
        acquisitionCostsEur: 14_000,
        monthlyRentEur: 1_400,
        monthlyHausgeldEur: 300,
        livingAreaM2: 80,
        renovationMinEur: 20_000,
        renovationMaxEur: 30_000,
        arvMinEur: 420_000,
        arvMaxEur: 460_000,
        holdingMonths: 9,
      },
      profile: { strategies: ["fix_flip"] },
      benchmark: reliableBenchmark,
    });
    const baseFlip = memo.underwriting.fixFlip.find((row) => row.name === "base");
    expect(memo.maxBidEur).toBe(baseFlip?.maxBidEur);
  });

  it("lässt eine im Bear Case negative Flip-Rechnung nicht gebotsfähig werden", () => {
    // Die Datenbank meldete hier früher "attraktive Fix&Flip-Chance", während
    // das Underwriting im Web negativ rechnete. Beides kam aus derselben
    // Eingabe, nur aus zwei Modellen. Jetzt entscheidet das Underwriting.
    const memo = buildInvestmentMemo({
      qualityInput: validQualityInput(),
      underwritingInput: {
        purchasePriceEur: 200_000,
        acquisitionCostsEur: 14_000,
        livingAreaM2: 80,
        renovationMinEur: 20_000,
        renovationMaxEur: 30_000,
        arvMinEur: 300_000,
        arvMaxEur: 340_000,
        holdingMonths: 9,
      },
      profile: { strategies: ["fix_flip"] },
      benchmark: reliableBenchmark,
    });
    const bear = memo.underwriting.fixFlip.find((row) => row.name === "bear");
    expect(bear?.profitEur).toBeLessThan(0);
    expect(memo.quality.eligibility.fixFlip).toBe(false);
    expect(memo.maxBidEur).toBeNull();
  });
});

describe("quality monitoring", () => {
  it("aggregiert Status und Eligibility reproduzierbar", () => {
    const ready = evaluateInvestorQuality(validQualityInput());
    const blockedInput = validQualityInput();
    const blocked = evaluateInvestorQuality({
      ...blockedInput,
      listing: { ...blockedInput.listing, needsReview: true },
    });
    const chance = (wert: number): ChanceErgebnis => ({
      wert,
      rohwert: wert,
      konfidenz: "mittel",
      datenreife: "bewertbar",
      datenreifeFaktor: 1,
      sondersituation: false,
      signale: [],
      begruendung: [],
      luecken: ["Marktmiete unbelegt"],
    });
    const report = aggregateInvestorQuality(
      [
        { quality: ready, chance: chance(60) },
        { quality: blocked, chance: chance(20) },
      ],
      new Date("2026-07-24T12:00:00.000Z"),
    );
    expect(report.total).toBe(2);
    expect(report.status.ready).toBe(1);
    expect(report.status.needs_review).toBe(1);
    expect(report.blockerRatePct).toBe(50);
    expect(report.averageChance).toBe(40);
    expect(report.datenreife.bewertbar).toBe(2);
    expect(report.topLuecken[0]).toEqual({ grund: "Marktmiete unbelegt", anzahl: 2 });
    expect(report.generatedAt).toBe("2026-07-24T12:00:00.000Z");
  });
});

describe("bestehender Buy-Hold-Rechner", () => {
  it("wendet den Anschlusszins nach Ende der Zinsbindung tatsächlich an", () => {
    const result = berechneBuyHoldProjektion({
      kaufpreisEur: 200_000,
      erwerbsnebenkostenEur: 14_000,
      eigenkapitalEur: 50_000,
      zinssatzPct: 3,
      tilgungssatzPct: 2,
      zinsbindungJahre: 1,
      anschlusszinssatzPct: 7,
      kaltmieteMonatlich: 1_200,
      mietsteigerungPct: 0,
      nichtUmlagefaehigeKostenMonatlich: 100,
      verwaltungMonatlich: 25,
      mietausfallwagnisPct: 2,
      grenzsteuersatzPct: 42,
      projektionsjahre: 3,
    });
    expect(result.anschlussMonatlicheRateEur).not.toBeNull();
    expect(result.jahre[1].zinsanteil).toBeGreaterThan(result.jahre[0].zinsanteil);
  });
});

describe("Investor-APIs ohne verwaiste Listings", () => {
  it("filtert Outcomes und Feedback auf existierende ZVG-Zeilen", () => {
    const exists = "EXISTS (SELECT 1 FROM zvg_listings z WHERE z.id =";
    const outcomes = readFileSync(
      path.join(__dirname, "../../app/api/investor/outcomes/route.ts"),
      "utf8",
    );
    const getOutcomes = outcomes.slice(
      outcomes.indexOf("export async function GET"),
      outcomes.indexOf("export async function PUT"),
    );
    expect(getOutcomes).toContain(exists);
    expect(getOutcomes).toContain("investorDealOutcomes.listingId");
    expect(getOutcomes).toContain(
      "desc(investorDealOutcomes.updatedAt), desc(investorDealOutcomes.id)",
    );

    const feedback = readFileSync(
      path.join(__dirname, "../../app/api/investor/feedback/route.ts"),
      "utf8",
    );
    const getFeedback = feedback.slice(
      feedback.indexOf("export async function GET"),
      feedback.indexOf("export async function POST"),
    );
    expect(getFeedback).toContain(exists);
    expect(getFeedback).toContain("investorAnalysisFeedback.listingId");
    expect(getFeedback).toContain(
      "desc(investorAnalysisFeedback.updatedAt), desc(investorAnalysisFeedback.id)",
    );

    const desk = readFileSync(path.join(__dirname, "../../lib/deal-desk.ts"), "utf8");
    expect(desk).toContain(exists);
    expect(desk).toContain("offline: stamm.istAktiv === false");
    expect(desk).toContain("isUpcomingTermin(eintrag.terminDate)");
    expect(desk).toContain("a.listingId.localeCompare(b.listingId)");
    expect(desk).toContain("compareDeskEintraege");
    expect(desk).toContain("desc(investorDealOutcomes.updatedAt), desc(investorDealOutcomes.id)");
    expect(desk).not.toContain("Number.MAX_SAFE_INTEGER");
    const deskClient = readFileSync(
      path.join(__dirname, "../../app/investor/desk/desk-client.tsx"),
      "utf8",
    );
    expect(deskClient).toContain("eintrag.offline");
    const heute = readFileSync(path.join(__dirname, "../../app/investor/page.tsx"), "utf8");
    expect(heute).toContain("eintrag.offline");
  });
});
