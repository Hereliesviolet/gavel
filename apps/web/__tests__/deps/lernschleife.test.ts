import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { berechneKalibrierung, vergleicheAbdeckung, type Beobachtung } from "@/lib/lernschleife";

const leer: Beobachtung = {
  gebotEur: null,
  maxGebotEur: null,
  verkaufspreisEur: null,
  arvMinEur: null,
  arvMaxEur: null,
  mieteEur: null,
  mietansatzEur: null,
  sanierungEur: null,
  sanierungMinEur: null,
  sanierungMaxEur: null,
};

function zeile(report: ReturnType<typeof berechneKalibrierung>, groesse: string) {
  const treffer = report.zeilen.find((z) => z.groesse.startsWith(groesse));
  if (!treffer) throw new Error(`Zeile ${groesse} fehlt`);
  return treffer;
}

describe("berechneKalibrierung", () => {
  it("meldet ohne Beobachtungen leere Zeilen statt erfundener Präzision", () => {
    const report = berechneKalibrierung([]);
    expect(report.mitZahlen).toBe(0);
    for (const z of report.zeilen) {
      expect(z.stichprobe).toBe(0);
      expect(z.medianAbweichungPct).toBeNull();
      expect(z.innerhalbSpanne).toBeNull();
    }
  });

  it("zählt einen Eintrag ohne vergleichbare Zahlen nicht mit", () => {
    const report = berechneKalibrierung([{ ...leer, gebotEur: 100_000 }]);
    expect(report.mitZahlen).toBe(0);
    expect(zeile(report, "Gebot").stichprobe).toBe(0);
  });

  it("rechnet die Abweichung des Gebots gegen das Maximalgebot", () => {
    const report = berechneKalibrierung([
      { ...leer, gebotEur: 110_000, maxGebotEur: 100_000 },
      { ...leer, gebotEur: 90_000, maxGebotEur: 100_000 },
      { ...leer, gebotEur: 120_000, maxGebotEur: 100_000 },
    ]);
    expect(zeile(report, "Gebot").stichprobe).toBe(3);
    expect(zeile(report, "Gebot").medianAbweichungPct).toBe(10);
    expect(report.mitZahlen).toBe(3);
  });

  it("nutzt bei Spannen die Mitte und misst zusätzlich die Treffer in der Spanne", () => {
    const report = berechneKalibrierung([
      { ...leer, verkaufspreisEur: 200_000, arvMinEur: 180_000, arvMaxEur: 220_000 },
      { ...leer, verkaufspreisEur: 150_000, arvMinEur: 180_000, arvMaxEur: 220_000 },
    ]);
    const verkauf = zeile(report, "Verkaufspreis");
    expect(verkauf.stichprobe).toBe(2);
    expect(verkauf.medianAbweichungPct).toBe(-12.5);
    expect(verkauf.innerhalbSpanne).toBe(50);
  });

  it("ignoriert unbrauchbare Modellwerte statt durch null zu teilen", () => {
    const report = berechneKalibrierung([
      { ...leer, mieteEur: 800, mietansatzEur: 0 },
      { ...leer, sanierungEur: 50_000, sanierungMinEur: 0, sanierungMaxEur: 0 },
    ]);
    expect(zeile(report, "Miete").stichprobe).toBe(0);
    expect(zeile(report, "Sanierung").stichprobe).toBe(0);
    expect(report.mitZahlen).toBe(0);
  });
});

describe("vergleicheAbdeckung", () => {
  it("rechnet die Veränderung bei gleicher Bezugsmenge", () => {
    const [zeile] = vergleicheAbdeckung(
      [{ merkmal: "ARV geschätzt", anzahl: 50, gesamt: 100, grundgesamtheit: "alle" }],
      [{ merkmal: "ARV geschätzt", anzahl: 70, gesamt: 100, grundgesamtheit: "alle" }],
    );
    expect(zeile.vorherPct).toBe(50);
    expect(zeile.nachherPct).toBe(70);
    expect(zeile.deltaPp).toBe(20);
  });

  // Der reale Fall: 465/722 gegen 438/519 sieht wie +20 pp aus, obwohl nur der
  // Nenner gewechselt hat und die absolute Zahl gesunken ist.
  it("weist bei gewechselter Bezugsmenge keine Veränderung aus", () => {
    const [zeile] = vergleicheAbdeckung(
      [{ merkmal: "Wohnfläche bekannt", anzahl: 465, gesamt: 722 }],
      [
        {
          merkmal: "Wohnfläche bekannt",
          anzahl: 438,
          gesamt: 519,
          grundgesamtheit: "Häuser und Wohnungen",
        },
      ],
    );
    expect(zeile.deltaPp).toBeNull();
  });

  it("vergleicht Altläufe ohne Angabe gegen den gesamten Bestand", () => {
    const [zeile] = vergleicheAbdeckung(
      [{ merkmal: "KI-Analyse vorhanden", anzahl: 655, gesamt: 722 }],
      [
        {
          merkmal: "KI-Analyse vorhanden",
          anzahl: 651,
          gesamt: 717,
          grundgesamtheit: "alle aktiven Objekte",
        },
      ],
    );
    expect(zeile.deltaPp).toBe(0);
  });

  it("überspringt Merkmale, die es im früheren Lauf noch nicht gab", () => {
    expect(
      vergleicheAbdeckung([], [{ merkmal: "Geringstes Gebot gelesen", anzahl: 3, gesamt: 100 }]),
    ).toHaveLength(0);
  });
});

describe("fetchKalibrierung", () => {
  it("nimmt KI-Werte nur mit Pick außerhalb der Review-Queue", () => {
    const src = readFileSync(path.join(__dirname, "../../lib/lernschleife.ts"), "utf8");
    const fn = src.slice(
      src.indexOf("export async function fetchKalibrierung"),
      src.indexOf("export async function fetchAbdeckungsverlauf"),
    );
    expect(fn).toContain(
      "INNER JOIN zvg_listings l ON l.id = o.listing_id AND l.needs_review = false",
    );
    expect(fn).not.toContain("LEFT JOIN zvg_listings");
    expect(fn).toContain("AND l.needs_review = false");
    expect(fn).toContain("arvMinEur: pick ? zahl(zeile.arv_min_eur) : null");
    expect(fn).toContain("mietansatzEur: zahl(pick?.metrics.mieteEur)");
    expect(fn).not.toContain("pick?.metrics.mieteEur ?? zeile.moegliche_kaltmiete");
    expect(fn).toContain("getInvestorProfile(userId)");
    expect(fn).toContain("o.strategy");
    expect(fn).toContain("fetchPicksByListingIds(");
    expect(fn).toContain("preferredStrategyByListingId");
    expect(fn).toContain("gebotEur: zahl(zeile.actual_bid_eur)");
    expect(fn).not.toContain("actual_bid_eur ?? zeile.actual_purchase_price_eur");
  });
});
