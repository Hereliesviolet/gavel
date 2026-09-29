import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  berechneMarktluecke,
  istBelastbar,
  kategorieAusTyp,
  listingKategorieFuerMarkt,
  listingKategorieFuerPeer,
  listingKategorieLabel,
  MARKTREFERENZ_MAX_ALTER_TAGE,
  MARKTREFERENZ_MIN_STICHPROBE,
  marktmieteEur,
  marktreferenzLabel,
  mikromarktAusPlz,
  type Marktreferenz,
} from "@/lib/market-reference";
import { pruefeMarktVorbehalte, reconcileStartedKandidat } from "@/lib/market-candidates";
import { rowToInvestorPick, type InvestorPickRow } from "@/lib/investor-picks";

function referenz(overrides: Partial<Marktreferenz> = {}): Marktreferenz {
  return {
    mikromarkt: "506",
    kategorie: "wohnung",
    angebotstyp: "kauf",
    medianEurM2: 2_500,
    p25EurM2: 2_100,
    p75EurM2: 3_000,
    stichprobe: 24,
    stand: new Date(),
    ...overrides,
  };
}

function zeile(overrides: Partial<InvestorPickRow> = {}): InvestorPickRow {
  const in30Tagen = new Date();
  in30Tagen.setDate(in30Tagen.getDate() + 30);
  return {
    listing: {
      id: "id-1",
      slug: "test",
      bundesland: "nrw",
      bundeslandName: "NRW",
      typ: "Wohnung",
      kategorie: "wohnung",
      adresse: "Test",
      ort: "Köln",
      verkehrswert: 100_000,
      wohnflaecheM2: 60,
      zimmer: "3",
      terminDate: in30Tagen,
      amtsgericht: "AG",
      plz: "50667",
      createdAt: new Date(),
      needsReview: false,
    },
    ki: { analyzedAt: new Date(), risikenInvestor: [] },
    coverImageUrl: null,
    preisProM2: 1_666,
    cashflowYieldPct: null,
    terminTage: 30,
    kategorieMedianM2: 2_500,
    marktreferenzKauf: referenz(),
    ...overrides,
  };
}

describe("Marktreferenz", () => {
  it("leitet den Mikromarkt aus der Postleitzahl ab", () => {
    expect(mikromarktAusPlz("50667")).toBe("506");
    expect(mikromarktAusPlz("D-50667")).toBe("506");
    expect(mikromarktAusPlz("5x6")).toBeNull();
    expect(mikromarktAusPlz(null)).toBeNull();
    expect(mikromarktAusPlz("1010")).toBeNull();
    expect(mikromarktAusPlz("8001")).toBeNull();
  });

  it("gilt erst ab der Mindeststichprobe als belastbar", () => {
    expect(istBelastbar(referenz({ stichprobe: MARKTREFERENZ_MIN_STICHPROBE }))).toBe(true);
    expect(istBelastbar(referenz({ stichprobe: MARKTREFERENZ_MIN_STICHPROBE - 1 }))).toBe(false);
  });

  it("verwirft eine veraltete Referenz", () => {
    const alt = new Date();
    alt.setDate(alt.getDate() - (MARKTREFERENZ_MAX_ALTER_TAGE + 1));
    expect(istBelastbar(referenz({ stand: alt }))).toBe(false);
  });

  it("nennt das Fehlen der Basis, statt es zu verschweigen", () => {
    expect(marktreferenzLabel(null)).toMatch(/Keine Vergleichsangebote/);
    expect(marktreferenzLabel(referenz({ stichprobe: 4 }))).toMatch(/zu klein/);
    expect(marktreferenzLabel(referenz())).toMatch(/n=24/);
  });

  it("berechnet die Lücke nur bei belastbarer Stichprobe", () => {
    expect(berechneMarktluecke(2_000, referenz())).toBeCloseTo(20, 5);
    expect(berechneMarktluecke(2_000, referenz({ stichprobe: 8 }))).toBeNull();
    expect(berechneMarktluecke(null, referenz())).toBeNull();
  });

  it("rechnet die Marktmiete aus Fläche und Mietmedian", () => {
    const miete = referenz({ angebotstyp: "miete", medianEurM2: 11 });
    expect(marktmieteEur(70, miete)).toBe(770);
    expect(marktmieteEur(70, referenz({ angebotstyp: "miete", stichprobe: 3 }))).toBeNull();
  });

  it("ordnet Typbezeichnungen einer Vergleichskategorie zu", () => {
    expect(kategorieAusTyp("Etagenwohnung")).toBe("wohnung");
    expect(kategorieAusTyp("Einfamilienhaus")).toBe("haus");
    expect(kategorieAusTyp("Anwesen mit Nebengebäuden")).toBe("haus");
    expect(kategorieAusTyp("Grundstück")).toBeNull();
    expect(listingKategorieFuerMarkt(null, "Einfamilienhaus")).toBe("haus");
    expect(listingKategorieFuerMarkt(null, "Anwesen mit Nebengebäuden")).toBe("haus");
    expect(listingKategorieFuerMarkt("wohnung", "Einfamilienhaus")).toBe("wohnung");
    expect(listingKategorieFuerMarkt("grundstueck", "Einfamilienhaus")).toBeNull();
    expect(listingKategorieFuerMarkt("gewerbe", null)).toBeNull();
    expect(listingKategorieFuerPeer("grundstueck", "Villa")).toBe("grundstueck");
    expect(listingKategorieFuerPeer(null, "Anwesen mit Nebengebäuden")).toBe("haus");
    expect(listingKategorieLabel(null, "Einfamilienhaus")).toBe("Haus");
    expect(listingKategorieLabel("grundstueck", "Villa")).toBe("Grundstück");
    expect(listingKategorieLabel(null, "Sonderobjekt")).toBe("Sonderobjekt");
  });
});

describe("Marktlücke als Signal", () => {
  it("ersetzt die ZVG-Peer-Abweichung in der Chance", () => {
    const pick = rowToInvestorPick(zeile(), "unter_markt");
    const ids = pick.chance.signale.map((signal) => signal.id);
    expect(ids).toContain("marktluecke");
    expect(ids).not.toContain("peer_abweichung");
  });

  it("benennt unterhalb der Mindeststichprobe die fehlende Basis", () => {
    const pick = rowToInvestorPick(
      zeile({ marktreferenzKauf: referenz({ stichprobe: 9 }) }),
      "unter_markt",
    );
    const signal = pick.chance.signale.find((eintrag) => eintrag.id === "marktluecke");
    expect(signal?.punkte).toBe(0);
    expect(signal?.fehlendeBasis).toMatch(/Stichprobe zu klein/);
    expect(pick.chance.luecken.join(" ")).toMatch(/Marktlücke/);
  });

  it("belohnt einen Abstand zum Angebotsniveau", () => {
    const mitLuecke = rowToInvestorPick(zeile(), "unter_markt").chance.wert;
    const ohneLuecke = rowToInvestorPick(
      zeile({ marktreferenzKauf: referenz({ medianEurM2: 1_600 }) }),
      "unter_markt",
    ).chance.wert;
    expect(mitLuecke).toBeGreaterThan(ohneLuecke);
  });

  it("meldet die Marktlücke als eigene Kennzahl mit Stichprobe", () => {
    const pick = rowToInvestorPick(zeile(), "unter_markt");
    expect(pick.metrics.marktlueckePct).toBeCloseTo(33.36, 1);
    expect(pick.metrics.marktreferenzStichprobe).toBe(24);
  });
});

describe("Mietbasis", () => {
  it("bevorzugt die Marktmiete gegenüber der Gutachtenmiete", () => {
    const pick = rowToInvestorPick(
      zeile({
        ki: { analyzedAt: new Date(), risikenInvestor: [], moeglicherKaltmiete: 400 },
        marktreferenzMiete: referenz({ angebotstyp: "miete", medianEurM2: 10 }),
      }),
      "buy_hold",
    );
    expect(pick.metrics.mietHerkunft).toBe("marktreferenz");
    expect(pick.metrics.mieteEur).toBe(600);
  });

  it("fällt ohne belastbare Mietreferenz auf die Gutachtenmiete zurück", () => {
    const pick = rowToInvestorPick(
      zeile({
        ki: { analyzedAt: new Date(), risikenInvestor: [], moeglicherKaltmiete: 400 },
        marktreferenzMiete: referenz({ angebotstyp: "miete", medianEurM2: 10, stichprobe: 3 }),
      }),
      "buy_hold",
    );
    expect(pick.metrics.mietHerkunft).toBe("gutachten");
    expect(pick.metrics.mieteEur).toBe(400);
    expect(pick.metrics.cashflowYieldPct).toBeCloseTo(4.8, 5);
  });

  it("rechnet Cashflow und Buy-Hold-Qualität mit der Marktmiete, nicht der Gutachtenmiete", () => {
    const pick = rowToInvestorPick(
      zeile({
        ki: { analyzedAt: new Date(), risikenInvestor: [], moeglicherKaltmiete: 20 },
        marktreferenzMiete: referenz({ angebotstyp: "miete", medianEurM2: 10 }),
        cashflowYieldPct: 0.96,
      }),
      "buy_hold",
    );
    expect(pick.metrics.mieteEur).toBe(600);
    expect(pick.metrics.cashflowYieldPct).toBeCloseTo(7.2, 5);
    expect(pick.quality.eligibility.buyHold).toBe(true);
  });
});

describe("Kandidaten-Vorprüfung", () => {
  it("verwirft Anzeigen mit erklärbarem Abschlag", () => {
    expect(pruefeMarktVorbehalte("Haus auf Erbbaurecht")).toMatch(/Erbbaurecht/);
    expect(pruefeMarktVorbehalte("Vermietete Wohnung, langjähriger Mieter")).toMatch(
      /Mieterschutz/,
    );
    expect(pruefeMarktVorbehalte("Wohn- und Geschäftshaus")).toMatch(/Gewerbe/);
    expect(pruefeMarktVorbehalte("Ferienhaus an der Ostsee")).toMatch(/Ferien/);
  });

  it("lässt einen unauffälligen Kandidaten durch", () => {
    expect(pruefeMarktVorbehalte("Einfamilienhaus mit Garten, sanierungsbedürftig")).toBeNull();
  });

  it("reconciliert gestartete Kandidaten erst nach öffentlicher Analyse", () => {
    const started = new Date("2026-01-01T00:00:00Z");
    expect(reconcileStartedKandidat(true, started, new Date("2026-01-01T00:10:00Z"))).toBe(
      "befoerdert",
    );
    expect(reconcileStartedKandidat(false, started, new Date("2026-01-01T00:10:00Z"))).toBe(
      "gestartet",
    );
    expect(reconcileStartedKandidat(false, started, new Date("2026-01-01T01:00:00Z"))).toBe(
      "offen",
    );
    const src = readFileSync(path.join(__dirname, "../../lib/market-candidates.ts"), "utf8");
    expect(src).toContain("isKnownListingSourceUrl(knownUrls, zeile.url)");
    expect(src).toContain("isKnownListingSourceUrl(knownUrls, kandidat.url)");
    expect(src).toContain("accepted.length < limit");
    expect(src).toContain(".offset(offset)");
    expect(src).toContain("desc(marketComparables.id)");
    expect(src).toContain("asc(marketComparables.befoerdertAm), asc(marketComparables.id)");
    expect(src).toContain("const maxBatches = 5");
    expect(src).not.toContain(
      '.where(eq(marketComparables.kandidatStatus, "gestartet"))\n    .limit(100);',
    );
  });
});

describe("Marktreferenz-Fenster", () => {
  it("zählt den Median nach letzter Sichtung, nicht nach Erstfassung", () => {
    const view = readFileSync(
      path.join(__dirname, "../../drizzle/migrations/0039_market_reference_zuletzt_gesehen.sql"),
      "utf8",
    );
    expect(view).toContain("max(zuletzt_gesehen_am) AS stand");
    expect(view).toContain("zuletzt_gesehen_am > NOW() - INTERVAL '120 days'");
    expect(view).not.toContain("erfasst_am > NOW()");
    const harvest = readFileSync(
      path.join(__dirname, "../../../../scrapers/src/storage/market.py"),
      "utf8",
    );
    const ziele = harvest.slice(
      harvest.indexOf("async def ernte_ziele"),
      harvest.indexOf("async def markiere_verschwundene"),
    );
    expect(ziele).toContain("zuletzt_gesehen_am > NOW() - INTERVAL '120 days'");
    expect(ziele).not.toContain("erfasst_am > NOW() - INTERVAL '120 days'");
  });
});
