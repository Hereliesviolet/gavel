import { describe, expect, it } from "vitest";
import { listingFlaecheFuerPreis, listingPreisProM2 } from "@/lib/listing-preis";

const friedrichstrasse = {
  kategorie: "gewerbe",
  typ: "Wohn-/Geschäftshaus",
  wohnflaecheM2: 1270,
  nutzflaecheM2: 25445,
  verkehrswert: 187_000_000,
};

describe("listingFlaecheFuerPreis", () => {
  it("nimmt bei Gewerbe die Nutzfläche", () => {
    expect(listingFlaecheFuerPreis(friedrichstrasse)).toEqual({
      m2: 25445,
      quelle: "nutz",
    });
  });

  it("nimmt bei Haus die Wohnfläche", () => {
    expect(
      listingFlaecheFuerPreis({
        kategorie: "haus",
        wohnflaecheM2: 166,
        nutzflaecheM2: 33,
      }),
    ).toEqual({ m2: 166, quelle: "wohn" });
  });
});

describe("listingPreisProM2", () => {
  it("zeigt Quartier 206 über die Nutzfläche, nicht 147.000 €/m²", () => {
    const eurM2 = listingPreisProM2(friedrichstrasse.verkehrswert, friedrichstrasse);
    expect(eurM2).not.toBeNull();
    expect(Math.round(eurM2!)).toBe(7349);
  });

  it("verbirgt unsinnige €/m² wenn nur die Wohnfläche von 1.270 m² da ist", () => {
    expect(
      listingPreisProM2(187_000_000, {
        kategorie: "haus",
        typ: "Wohn-/Geschäftshaus",
        wohnflaecheM2: 1270,
      }),
    ).toBeNull();
  });
});
