import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPreset,
  finderDiscountPct,
  isTerminWithinDays,
  isZeitnahTermin,
  parseFinderFiltersFromSearchParams,
  pickMeetsCashflowMin,
  unterMarktGapPct,
} from "@/lib/investor-finder";
import { retainReachableFavorites } from "@/lib/analyse-access";
import {
  buildEinstiegHook,
  EINSTIEG_MIN_CHANCE,
  passesEinstiegCriteria,
} from "@/lib/einstieg-picks";
import {
  buildDealHook,
  formatTerminRelativ,
  hasFixFlipBasis,
  isDiscoveryCandidate,
  isExcludedFromHero,
  rowToInvestorPick,
  selectDiscoveryStrategy,
  type InvestorPickRow,
} from "@/lib/investor-picks";
import { isAuctionInInvestorPeriod, isListingInInvestorPeriod } from "@/lib/investor-queries";
import { SONDERSITUATION_DECKEL } from "@/lib/investor-signals";

function baseRow(overrides: Partial<InvestorPickRow> = {}): InvestorPickRow {
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

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
      terminDate: in30Days,
      amtsgericht: "AG",
      plz: "50667",
      createdAt: new Date(),
    },
    ki: {
      investmentScore: "neutral",
      fixFlipMassnahmen: [{ beschreibung: "Bad und Böden modernisieren" }],
      risikenInvestor: [],
      fixFlipGesamtkostenMinEur: 10_000,
      fixFlipGesamtkostenMaxEur: 15_000,
      arvMinEur: 240_000,
      arvMaxEur: 270_000,
      arvKonfidenz: "mittel",
      innenbesichtigung: true,
      holdingMonate: 9,
      analyzedAt: new Date(),
    },
    coverImageUrl: null,
    preisProM2: 1666,
    cashflowYieldPct: null,
    terminTage: 30,
    kategorieMedianM2: 2500,
    benchmark: {
      medianEurM2: 2500,
      p25EurM2: 2200,
      p75EurM2: 2800,
      sampleSize: 20,
      scope: "category_state",
      confidence: "high",
      sufficient: true,
      reliable: true,
    },
    marktreferenzKauf: {
      mikromarkt: "506",
      kategorie: "wohnung",
      angebotstyp: "kauf",
      medianEurM2: 2500,
      p25EurM2: 2200,
      p75EurM2: 2800,
      stichprobe: 24,
      stand: new Date(),
    },
    ...overrides,
  };
}

describe("investor-finder presets", () => {
  it("einsteiger-paket setzt vwMax und einstiegOnly", () => {
    const f = applyPreset({ preset: "einsteiger-paket" });
    expect(f.vwMax).toBe(350_000);
    expect(f.einstiegOnly).toBe(true);
    expect(f.excludeHardRisk).toBe(true);
  });

  it("parseFinderFilters überschreibt Preset nicht mit einstiegOnly=false", () => {
    const f = applyPreset(parseFinderFiltersFromSearchParams({ preset: "einsteiger-paket" }));
    expect(f.einstiegOnly).toBe(true);
    expect(f.vwMax).toBe(350_000);
  });

  it("ignoriert unbekannte strategy- und preset-Parameter", () => {
    const f = parseFinderFiltersFromSearchParams({ strategy: "foo", preset: "bar" });
    expect(f.strategy).toBeUndefined();
    expect(f.preset).toBeUndefined();
    expect(parseFinderFiltersFromSearchParams({ strategy: "fix_flip", preset: "zeitnah" })).toEqual(
      expect.objectContaining({ strategy: "fix_flip", preset: "zeitnah" }),
    );
  });

  it("kapselt Finder-Limit und Offset", () => {
    const f = parseFinderFiltersFromSearchParams({ limit: "9999", offset: "-5" });
    expect(f.limit).toBe(50);
    expect(f.offset).toBe(0);
    expect(parseFinderFiltersFromSearchParams({ offset: "99999" }).offset).toBe(2000);
  });

  it("cashflow-nrw nutzt kanonischen Bundesland-Slug nordrhein-westfalen", () => {
    const f = applyPreset({ preset: "cashflow-nrw" });
    expect(f.strategy).toBe("buy_hold");
    expect(f.bundesland).toEqual(["nordrhein-westfalen"]);
    expect(f.cashflowMin).toBe(3);
  });

  it("discount_min nutzt die Marktlücke, Peer nur als Fallback", () => {
    const metrics = { marktlueckePct: 18, discountVsMedianPct: 4 };
    expect(finderDiscountPct("unter_markt", metrics)).toBe(18);
    expect(finderDiscountPct("fix_flip", metrics)).toBe(18);
    expect(finderDiscountPct(undefined, metrics)).toBe(18);
    expect(finderDiscountPct("fix_flip", { marktlueckePct: null, discountVsMedianPct: 4 })).toBe(4);
    expect(
      finderDiscountPct("unter_markt", { marktlueckePct: null, discountVsMedianPct: 4 }),
    ).toBeNull();
    expect(unterMarktGapPct({ marktlueckePct: 18 })).toBe(18);
    expect(unterMarktGapPct({ marktlueckePct: null })).toBeNull();
  });

  it("cashflowMin prüft die angezeigte CoC, nicht die Gutachten-Miete", () => {
    expect(pickMeetsCashflowMin(3.2, 3)).toBe(true);
    expect(pickMeetsCashflowMin(2.9, 3)).toBe(false);
    expect(pickMeetsCashflowMin(null, 3)).toBe(false);
    expect(pickMeetsCashflowMin(null, undefined)).toBe(true);
  });
});

describe("retainReachableFavorites", () => {
  it("verwirft ZVG-Waisen und unbekannte Typen, behält vorhandene IDs", () => {
    const kept = retainReachableFavorites(
      [
        { listingId: "zvg-1", listingType: "zvg" },
        { listingId: "gone", listingType: "zvg" },
        { listingId: "re-1", listingType: "real_estate" },
        { listingId: "re-gone", listingType: "real_estate" },
        { listingId: "x", listingType: "other" },
      ],
      ["zvg-1"],
      ["re-1"],
    );
    expect(kept).toEqual([
      { listingId: "zvg-1", listingType: "zvg" },
      { listingId: "re-1", listingType: "real_estate" },
    ]);
  });
});

describe("einstieg criteria", () => {
  it("lehnt abraten ab", () => {
    expect(
      passesEinstiegCriteria(baseRow({ ki: { ...baseRow().ki, investmentScore: "abraten" } })),
    ).toBe(false);
  });

  it("akzeptiert valides Einstiegsobjekt", () => {
    expect(passesEinstiegCriteria(baseRow())).toBe(true);
    expect(rowToInvestorPick(baseRow(), "unter_markt").chance.wert).toBeGreaterThanOrEqual(
      EINSTIEG_MIN_CHANCE,
    );
  });

  it("akzeptiert Objekt mit VW bis 350k", () => {
    expect(
      passesEinstiegCriteria(
        baseRow({
          listing: { ...baseRow().listing, verkehrswert: 300_000 },
          ki: {
            ...baseRow().ki,
            arvMinEur: 600_000,
            arvMaxEur: 650_000,
            fixFlipGesamtkostenMinEur: 30_000,
            fixFlipGesamtkostenMaxEur: 40_000,
          },
        }),
      ),
    ).toBe(true);
  });

  it("lehnt Anti-Signale ab", () => {
    expect(
      passesEinstiegCriteria(
        baseRow({
          ki: {
            ...baseRow().ki,
            risikenInvestor: ["Lebenslanges Wohnrecht bleibt bestehen"],
          },
        }),
      ),
    ).toBe(false);
  });

  it("lässt ein einzelnes bezifferbares Risiko im ausgewogenen Profil zu", () => {
    expect(
      passesEinstiegCriteria(
        baseRow({
          ki: {
            ...baseRow().ki,
            risikenInvestor: ["Überschwemmungsrisiko im Keller"],
          },
        }),
      ),
    ).toBe(true);
  });

  it("benennt die Marktlücke im Einstiegshook, nicht den Peer-Median", () => {
    const hook = buildEinstiegHook(rowToInvestorPick(baseRow(), "unter_markt"));
    expect(hook).toMatch(/Angebotsniveau/);
    expect(hook).not.toMatch(/Peer-Median/);
  });

  it("behält eine belastbare ZVG-Peer-Abweichung als Signal sichtbar", () => {
    const row = baseRow({
      ki: { ...baseRow().ki, moeglicherKaltmiete: null },
    });
    const pick = rowToInvestorPick(row, "unter_markt");
    expect(pick.chance.wert).toBeGreaterThan(0);
    expect(pick.chance.sondersituation).toBe(false);
    expect(isDiscoveryCandidate(row, "unter_markt")).toBe(true);
    expect(passesEinstiegCriteria(row)).toBe(true);
  });
});

describe("investor periods", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const dateAt = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1_000);

  it("zählt neue Investmentkandidaten, aber nicht als zeitnahen Termin", () => {
    const listing = { createdAt: dateAt(-2), terminDate: dateAt(60) };
    expect(isListingInInvestorPeriod(listing, "week", now)).toBe(true);
    expect(isAuctionInInvestorPeriod(listing.terminDate, "week", now)).toBe(false);
  });

  it("begrenzt neue oder anstehende Objekte auf 7 beziehungsweise 30 Tage", () => {
    expect(isAuctionInInvestorPeriod(dateAt(7), "week", now)).toBe(true);
    expect(isAuctionInInvestorPeriod(dateAt(8), "week", now)).toBe(false);
    expect(isAuctionInInvestorPeriod(dateAt(30), "month", now)).toBe(true);
    expect(isAuctionInInvestorPeriod(dateAt(31), "month", now)).toBe(false);
  });

  it("hält date-only Termine am Auktionstag in der Periode", () => {
    const auctionNow = new Date("2026-08-10T12:00:00.000Z");
    const dateOnlyToday = new Date("2026-08-09T22:00:00.000Z");
    expect(isAuctionInInvestorPeriod(dateOnlyToday, "week", auctionNow)).toBe(true);
    expect(
      isListingInInvestorPeriod(
        { createdAt: new Date("2026-01-01T00:00:00.000Z"), terminDate: dateOnlyToday },
        "week",
        auctionNow,
      ),
    ).toBe(true);
  });

  it("grenzt zeitnahe Termine auf 14 Tage", () => {
    expect(isZeitnahTermin(dateAt(14), now)).toBe(true);
    expect(isZeitnahTermin(dateAt(15), now)).toBe(false);
    expect(isZeitnahTermin(dateAt(-1), now)).toBe(false);
    expect(isZeitnahTermin(null, now)).toBe(false);
    expect(isTerminWithinDays(dateAt(7), 7, now)).toBe(true);
    expect(isTerminWithinDays(dateAt(8), 7, now)).toBe(false);
    expect(isDiscoveryCandidate(baseRow({ terminTage: 14 }), "zeitnah")).toBe(true);
    expect(isDiscoveryCandidate(baseRow({ terminTage: 15 }), "zeitnah")).toBe(false);
    expect(isDiscoveryCandidate(baseRow(), "fix_flip", { strategies: ["buy_hold"] })).toBe(false);
    expect(
      isDiscoveryCandidate(
        baseRow(),
        "fix_flip",
        { strategies: ["buy_hold"] },
        {
          enforceProfileStrategies: false,
        },
      ),
    ).toBe(true);
    const nurKosten = baseRow({
      ki: {
        ...baseRow().ki,
        fixFlipMassnahmen: [],
        arvMinEur: null,
        fixFlipGesamtkostenMinEur: 20_000,
      },
    });
    expect(hasFixFlipBasis(nurKosten.ki)).toBe(true);
    expect(isDiscoveryCandidate(nurKosten, "fix_flip")).toBe(true);
    expect(
      hasFixFlipBasis({
        fixFlipMassnahmen: [],
        arvMinEur: null,
        fixFlipGesamtkostenMinEur: null,
      }),
    ).toBe(false);
  });
});

describe("selectDiscoveryStrategy", () => {
  const ohneFlipBasis = (overrides: Partial<InvestorPickRow> = {}): InvestorPickRow => {
    const ki = overrides.ki ?? {};
    return baseRow({
      ...overrides,
      ki: {
        ...baseRow().ki,
        fixFlipMassnahmen: [],
        arvMinEur: null,
        arvMaxEur: null,
        fixFlipGesamtkostenMinEur: null,
        fixFlipGesamtkostenMaxEur: null,
        ...ki,
      },
    });
  };

  it("nimmt Buy-&-Hold wenn nur Miete tragfähig ist", () => {
    expect(
      selectDiscoveryStrategy(ohneFlipBasis({ ki: { moeglicherKaltmiete: 850 } }), undefined),
    ).toBe("buy_hold");
  });

  it("nimmt Fix-&-Flip wenn eine Flip-Grundlage da ist", () => {
    expect(selectDiscoveryStrategy(baseRow(), undefined)).toBe("fix_flip");
  });

  it("folgt dem Profil wenn Fix-&-Flip abgewählt ist", () => {
    expect(
      selectDiscoveryStrategy(baseRow({ ki: { ...baseRow().ki, moeglicherKaltmiete: 850 } }), {
        strategies: ["buy_hold"],
      }),
    ).toBe("buy_hold");
  });

  it("nimmt Marktlücke wenn Flip und Miete fehlen", () => {
    expect(selectDiscoveryStrategy(ohneFlipBasis(), undefined)).toBe("unter_markt");
  });

  it("nimmt unter_markt nur bei positiver Marktluecke", () => {
    const ueberMarkt = ohneFlipBasis({ preisProM2: 4000 });
    expect(isDiscoveryCandidate(ueberMarkt, "unter_markt")).toBe(false);
    expect(selectDiscoveryStrategy(ueberMarkt, undefined)).toBeNull();
    expect(
      selectDiscoveryStrategy(ohneFlipBasis({ preisProM2: 4000, terminTage: 5 }), undefined),
    ).toBe("zeitnah");
    expect(isDiscoveryCandidate(ohneFlipBasis({ preisProM2: 2500 }), "unter_markt")).toBe(false);
    expect(isDiscoveryCandidate(ohneFlipBasis({ marktreferenzKauf: null }), "unter_markt")).toBe(
      false,
    );
  });

  it("beschreibt den Auktionstag als heute statt in 0 Tagen", () => {
    expect(formatTerminRelativ(0)).toBe("heute");
    expect(formatTerminRelativ(1)).toBe("in 1 Tag");
    expect(formatTerminRelativ(5)).toBe("in 5 Tagen");
    const hook = buildDealHook(rowToInvestorPick(baseRow({ terminTage: 0 }), "zeitnah"));
    expect(hook).toContain("Versteigerung heute");
    expect(hook).not.toContain("in 0 Tagen");
    const chips = readFileSync(
      path.join(__dirname, "../../components/investor/metric-chips.tsx"),
      "utf8",
    );
    expect(chips).toContain("formatTerminRelativ(pick.metrics.terminTage)");
    expect(chips).not.toContain("Termin in ${pick.metrics.terminTage} Tagen");
  });

  it("Discovery-Hook unterscheidet fehlende Referenz und Ueber-Markt", () => {
    expect(buildDealHook(rowToInvestorPick(baseRow(), "unter_markt"))).toMatch(
      /unter dem Angebotsniveau/,
    );
    expect(buildDealHook(rowToInvestorPick(baseRow({ preisProM2: 4000 }), "unter_markt"))).toMatch(
      /über dem Angebotsniveau/,
    );
    expect(
      buildDealHook(rowToInvestorPick(baseRow({ marktreferenzKauf: null }), "unter_markt")),
    ).toMatch(/keine belastbare Marktreferenz/);
  });

  it("lehnt ein explizites Flip-Preset ohne Flip-Grundlage ab", () => {
    expect(
      selectDiscoveryStrategy(ohneFlipBasis(), undefined, { explicit: "fix_flip" }),
    ).toBeNull();
  });

  it("nimmt Zeitnah wenn kein anderes Signal passt", () => {
    expect(
      selectDiscoveryStrategy(ohneFlipBasis({ marktreferenzKauf: null, terminTage: 5 }), undefined),
    ).toBe("zeitnah");
  });
});

describe("profile-aware risk gates", () => {
  it("senkt die Konfidenz bei mehreren materiellen Risiken", () => {
    const row = baseRow({
      ki: {
        ...baseRow().ki,
        risikenInvestor: [
          "Strukturschwache Lage mit Leerstandsrisiko",
          "Sonderumlage der WEG möglich",
        ],
      },
    });
    const pick = rowToInvestorPick(row, "fix_flip");
    expect(pick.quality.warnings.length).toBeGreaterThan(0);
    expect(pick.chance.konfidenz).not.toBe("hoch");
  });

  it("hält komplexe ZVG-Konstellationen als Sondersituation auffindbar", () => {
    const row = baseRow({
      ki: {
        ...baseRow().ki,
        risikenInvestor: ["Versteigert wird ein 1/2-Miteigentumsanteil mit komplexer Besitzlage"],
      },
    });
    const pick = rowToInvestorPick(row, "unter_markt");
    expect(pick.chance.sondersituation).toBe(true);
    expect(pick.chance.wert).toBeLessThanOrEqual(SONDERSITUATION_DECKEL);
    expect(isDiscoveryCandidate(row, "unter_markt")).toBe(true);
    expect(passesEinstiegCriteria(row)).toBe(false);
  });
});

describe("Aufmacher und Hook bei negativer Leitzahl", () => {
  // ARV unter Kaufpreis plus Sanierung: der Flip ist beim Referenzgebot
  // defizitär, das Objekt bleibt wegen seiner Signale aber auffindbar.
  const defizitaerRow = () =>
    baseRow({
      ki: {
        ...baseRow().ki,
        arvMinEur: 70_000,
        arvMaxEur: 75_000,
        fixFlipGesamtkostenMinEur: 30_000,
        fixFlipGesamtkostenMaxEur: 40_000,
      },
    });

  it("nennt im Hook den Preis statt der negativen Marge", () => {
    const pick = rowToInvestorPick(defizitaerRow(), "fix_flip");
    expect(pick.metrics.baseFlipMarginPct).toBeLessThanOrEqual(0);
    expect(pick.hook).not.toMatch(/^-\d+ % Flip-Marge/);
    expect(pick.hook).toMatch(/Rechnet sich erst unter|Kein Gebotspreis erreicht/);
  });

  it("lässt ein defizitäres Objekt nicht zum Aufmacher werden", () => {
    expect(isExcludedFromHero(rowToInvestorPick(defizitaerRow(), "fix_flip"))).toBe(true);
  });

  it("lässt ein tragfähiges Objekt weiterhin zu", () => {
    const pick = rowToInvestorPick(baseRow(), "fix_flip");
    expect(pick.metrics.baseFlipMarginPct).toBeGreaterThan(0);
    expect(isExcludedFromHero(pick)).toBe(false);
    expect(pick.hook).toMatch(/% Flip-Marge beim/);
  });
});

describe("Investment-Abdeckung", () => {
  it("zählt nur Listings außerhalb der Datenqualitäts-Review", () => {
    const src = readFileSync(path.join(__dirname, "../../lib/investor-queries.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function fetchInvestmentCoverage"));
    expect(fn).toContain("eq(zvgListings.needsReview, false)");
    expect(fn).toContain("coverageWhere");
  });
});

describe("Investor-Kohorte ohne Review-Queue", () => {
  it("filtert Bewegung, Datenbasis und Marktstatistiken", () => {
    const queries = readFileSync(path.join(__dirname, "../../lib/investor-queries.ts"), "utf8");
    const veraenderungen = queries.slice(
      queries.indexOf("export async function fetchVeraenderungen"),
    );
    expect(veraenderungen).toContain("AND l.needs_review = false");
    expect(veraenderungen).toContain("eq(zvgListings.needsReview, false)");
    expect(veraenderungen).toContain("const gesehen = new Set");
    expect(veraenderungen).toContain("!gesehen.has(row.id)");
    expect(veraenderungen).toContain("addZonedCalendarDays");
    expect(veraenderungen).toContain("startOfZonedDay");
    expect(veraenderungen).toContain("seitIso");
    expect(veraenderungen).toContain("::timestamptz");
    expect(veraenderungen).toContain("ORDER BY v.erfasst_am DESC, v.listing_id, v.id DESC");
    expect(veraenderungen).toContain("(v.termin_date AT TIME ZONE 'Europe/Berlin')::date");
    expect(veraenderungen).toContain("(v.termin_vorher AT TIME ZONE 'Europe/Berlin')::date");
    expect(veraenderungen).not.toContain("v.termin_date IS DISTINCT FROM v.termin_vorher");
    expect(queries).toContain(".orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))");
    expect(queries).toContain(".orderBy(desc(zvgKiAnalyses.analyzedAt), desc(zvgListings.id))");
    expect(queries).toContain(".orderBy(desc(MARKTLUECKE_SQL), asc(zvgListings.id))");
    expect(queries).toContain("sql`market_reference ref`");
    expect(queries).toContain("marktKategorieSql()");
    expect(queries).toContain("mikromarktSql()");
    expect(queries).toContain("MARKTREFERENZ_MIN_STICHPROBE");
    expect(queries).toContain("MARKTREFERENZ_MAX_ALTER_TAGE");
    expect(queries).not.toContain(".orderBy(asc(PREIS_PRO_M2_SQL), asc(zvgListings.id))");
    expect(queries).toContain(
      ".orderBy(desc(zvgKiAnalyses.analyzedAt), desc(zvgListings.createdAt), desc(zvgListings.id))",
    );
    expect(veraenderungen).toContain("desc(zvgListings.createdAt), desc(zvgListings.id)");
    expect(queries).toContain(
      ".orderBy(desc(zvgAuctionEvents.erfasstAm), desc(zvgAuctionEvents.id))",
    );
    expect(veraenderungen).not.toContain("seit.setDate");
    expect(veraenderungen).not.toContain("INTERVAL");

    const datenbasis = readFileSync(path.join(__dirname, "../../lib/datenbasis.ts"), "utf8");
    expect(datenbasis).toContain("MARKTREFERENZ_MIN_STICHPROBE");
    expect(datenbasis).toContain("MARKTREFERENZ_MAX_ALTER_TAGE");
    expect(datenbasis).toContain("mikromarktSql()");
    expect(datenbasis).toContain("marktKategorieSql()");
    expect(datenbasis).not.toContain("left(l.plz, 3)");
    expect(datenbasis).not.toContain("const MIN_STICHPROBE");
    expect(datenbasis).toContain("WHERE l.ist_aktiv AND l.needs_review = false");
    expect(datenbasis).toContain("${zvgListings.wohnflaecheM2}");
    expect(datenbasis).not.toContain("AND l.wohnflaeche_m2 IS NOT NULL");
    expect(datenbasis).toContain("FROM ${zvgListings}");
    expect(datenbasis).toContain("FROM zvg_auction_events e");
    expect(datenbasis).toContain("INNER JOIN zvg_listings l ON l.id = e.listing_id");
    expect(datenbasis).toContain("AND l2.ist_aktiv AND l2.needs_review = false");
    expect(datenbasis).toContain("(e.termin_date AT TIME ZONE 'Europe/Berlin')::date");
    expect(datenbasis).toContain(
      "IS NOT DISTINCT FROM (${zvgListings.terminDate} AT TIME ZONE 'Europe/Berlin')::date",
    );
    expect(datenbasis).not.toContain("e.termin_date IS NOT DISTINCT FROM l.termin_date");

    expect(queries).toContain("(e.termin_date AT TIME ZONE 'Europe/Berlin')::date");
    expect(queries).toContain(
      'IS NOT DISTINCT FROM ("zvg_listings"."termin_date" AT TIME ZONE \'Europe/Berlin\')::date',
    );
    expect(queries).toContain(
      "(${zvgAuctionEvents.terminDate} AT TIME ZONE 'Europe/Berlin')::date",
    );
    expect(queries).toContain(
      "IS NOT DISTINCT FROM (${zvgListings.terminDate} AT TIME ZONE 'Europe/Berlin')::date",
    );
    expect(queries).not.toContain(
      'e.termin_date IS NOT DISTINCT FROM "zvg_listings"."termin_date"',
    );

    const stats = readFileSync(path.join(__dirname, "../../lib/market-stats.ts"), "utf8");
    expect(stats).toContain("const activeQuality = and(");
    expect(stats).toContain("eq(zvgListings.needsReview, false)");
    expect(stats).not.toMatch(/\.where\(\s*eq\(zvgListings\.istAktiv, true\)\s*\)/);
    expect(stats).toContain(".innerJoin(zvgListings, eq(zvgKiAnalyses.listingId, zvgListings.id))");
    expect(stats).toContain("throw e");

    const picks = queries.slice(queries.indexOf("export async function fetchPicksByListingIds"));
    expect(picks).toContain("if (row.listing.needsReview) continue");

    const strategyRows = queries.slice(queries.indexOf("const fetchStrategyRows"));
    expect(strategyRows).toContain("FIX_FLIP_BASIS_SQL");
    const finder = readFileSync(path.join(__dirname, "../../lib/investor-finder.ts"), "utf8");
    expect(finder).toContain("export const FIX_FLIP_BASIS_SQL");
    expect(finder).toContain("jsonb_array_length(COALESCE(${zvgKiAnalyses.fixFlipMassnahmen}");
    expect(finder).toContain("conditions.push(FIX_FLIP_BASIS_SQL)");
    expect(queries).toContain("enforceProfileStrategies: !explicitStrategy");
    expect(queries).toContain("selectDiscoveryStrategy(row, profileInput");
    expect(queries).toContain("enrichEinstiegPick(row, strategy, profileInput)");
    const picksSrc = readFileSync(path.join(__dirname, "../../lib/investor-picks.ts"), "utf8");
    expect(picksSrc).toContain("export function hasFixFlipBasis");
    expect(picksSrc).toContain("hasFixFlipBasis(row.ki)");
    expect(picksSrc).toContain("export function selectDiscoveryStrategy");
    const einstieg = readFileSync(path.join(__dirname, "../../lib/einstieg-picks.ts"), "utf8");
    expect(einstieg).toContain("selectDiscoveryStrategy(row, profileInput)");
    const sucheFilter = readFileSync(
      path.join(__dirname, "../../app/investor/suche/suche-filter.tsx"),
      "utf8",
    );
    expect(sucheFilter).toContain("applyPreset(parseFinderFiltersFromSearchParams(raw))");
    expect(sucheFilter).toContain("checked={excludeHardRisk}");
    expect(sucheFilter).toContain('if (resetOffset) params.delete("offset")');
    expect(sucheFilter).toContain('params.set("offset", String(offset + pageSize))');
    expect(sucheFilter).toContain(
      'shown.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")} Treffer',
    );
  });
});
