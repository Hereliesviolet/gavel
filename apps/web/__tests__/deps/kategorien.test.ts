import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isListingKategorie, parseListingKategorien } from "@/lib/kategorien";
import {
  inferListingKategorie,
  listingMatchesWantedTypes,
  listingTypeColumnMatches,
  marktKategorieSql,
  mikromarktSql,
  peerKategorieSql,
} from "@/lib/listing-type-filter";

describe("parseListingKategorien", () => {
  it("lässt nur bekannte Kategorien durch", () => {
    expect(parseListingKategorien(["wohnung", "DROP TABLE", "haus"])).toEqual(["wohnung", "haus"]);
    expect(isListingKategorie("gewerbe")).toBe(true);
    expect(isListingKategorie("alles")).toBe(false);
  });
});

describe("listingTypeColumnMatches", () => {
  it("liefert keinen Filter ohne Objektarten", () => {
    expect(listingTypeColumnMatches([])).toBeUndefined();
    expect(listingTypeColumnMatches(["", "  "])).toBeUndefined();
  });

  it("bildet einen Kategorie-oder-Typ-Filter", () => {
    expect(listingTypeColumnMatches(["wohnung"])).toBeDefined();
    expect(listingTypeColumnMatches(["Wohnung", "wohnung"])).toBeDefined();
    const src = readFileSync(path.join(__dirname, "../../lib/listing-type-filter.ts"), "utf8");
    expect(src).toContain("listingKategorieFuerPeer");
    expect(src).toContain("${peerKategorieSql()} IN");
  });

  it("bildet die Peer-Kategorie analog zur JS-Inferenz", () => {
    expect(peerKategorieSql()).toBeDefined();
  });

  it("bindet Typ-Tokens als Literale, damit GROUP BY denselben CASE sieht", () => {
    const src = readFileSync(path.join(__dirname, "../../lib/listing-type-filter.ts"), "utf8");
    expect(src).toContain("sqlStringLiteral");
    expect(src).not.toMatch(
      /strpos\(lower\(coalesce\(\$\{zvgListings\.typ\}, ''\)\), \$\{token\}\)/,
    );
  });

  it("bildet die Marktkategorie analog zu listingKategorieFuerMarkt", () => {
    expect(marktKategorieSql()).toBeDefined();
    expect(mikromarktSql()).toBeDefined();
    const src = readFileSync(path.join(__dirname, "../../lib/listing-type-filter.ts"), "utf8");
    expect(src).toContain("listingKategorieFuerMarkt");
    expect(src).toContain("mikromarktAusPlz");
    expect(src).toContain("THEN NULL");
    expect(src).not.toMatch(
      /export function marktKategorieSql[\s\S]*grundstueck[\s\S]*THEN 'grundstueck'/,
    );
  });
});

describe("inferListingKategorie", () => {
  it("nutzt dieselben Tokens wie die Scraper und kein bloßes land/grund", () => {
    expect(inferListingKategorie("Erbbaurecht an einem Grundstück")).toBe("grundstueck");
    expect(inferListingKategorie("Anwesen mit Nebengebäuden")).toBe("haus");
    expect(inferListingKategorie("Urlaubsland")).toBeNull();
    expect(inferListingKategorie("Begründung")).toBeNull();
    expect(inferListingKategorie("Hotelzimmer")).toBeNull();
    expect(inferListingKategorie("3-Zimmer-Wohnung")).toBe("wohnung");
    expect(inferListingKategorie("Wohnung im Mehrfamilienhaus")).toBe("wohnung");
    expect(inferListingKategorie("Wohn-/Geschäftshaus")).toBe("gewerbe");
    expect(inferListingKategorie("Geschäftshaus Friedrichstraße")).toBe("gewerbe");
    expect(inferListingKategorie("Mehrfamilienhaus mit Laden")).toBe("haus");
  });
});

describe("listingMatchesWantedTypes", () => {
  it("nutzt den Typ nur wenn die Kategorie fehlt", () => {
    expect(
      listingMatchesWantedTypes({ kategorie: "wohnung", typ: "Wohnung im Mehrfamilienhaus" }, [
        "haus",
      ]),
    ).toBe(false);
    expect(
      listingMatchesWantedTypes({ kategorie: null, typ: "Wohnung im Mehrfamilienhaus" }, ["haus"]),
    ).toBe(false);
    expect(
      listingMatchesWantedTypes({ kategorie: null, typ: "Wohnung im Mehrfamilienhaus" }, [
        "wohnung",
      ]),
    ).toBe(true);
    expect(
      listingMatchesWantedTypes({ kategorie: null, typ: "Anwesen mit Nebengebäuden" }, ["haus"]),
    ).toBe(true);
    expect(listingMatchesWantedTypes({ kategorie: "haus", typ: "Villa" }, ["haus"])).toBe(true);
    expect(listingMatchesWantedTypes({ kategorie: "", typ: "Einfamilienhaus" }, ["haus"])).toBe(
      true,
    );
    expect(
      listingMatchesWantedTypes({ kategorie: "sonstiges", typ: "Einfamilienhaus" }, ["haus"]),
    ).toBe(true);
    expect(
      listingMatchesWantedTypes({ kategorie: "Wohnung", typ: "Einfamilienhaus" }, ["wohnung"]),
    ).toBe(true);
  });
});
