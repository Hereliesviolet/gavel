import { describe, expect, it } from "vitest";
import {
  findBundesland,
  germanPostalCode,
  normalizeBundeslandSlug,
  pickTopBundeslandByCount,
  plzToBundesland,
} from "@/lib/bundesland";

describe("normalizeBundeslandSlug", () => {
  it("kennt Kürzel, Namen und NRW-Alias", () => {
    expect(normalizeBundeslandSlug("NW")).toBe("nordrhein-westfalen");
    expect(normalizeBundeslandSlug("NRW")).toBe("nordrhein-westfalen");
    expect(normalizeBundeslandSlug("Baden-Württemberg")).toBe("badenwuerttemberg");
    expect(normalizeBundeslandSlug("BW")).toBe("badenwuerttemberg");
    expect(findBundesland("by")?.slug).toBe("bayern");
  });
});

describe("pickTopBundeslandByCount", () => {
  it("merkt Scraper-Aliase und wählt das Maximum", () => {
    const top = pickTopBundeslandByCount([
      { bundesland: "baden-wuerttemberg", anzahl: 4 },
      { bundesland: "badenwuerttemberg", anzahl: 3 },
      { bundesland: "NRW", anzahl: 5 },
      { bundesland: "nordrhein-westfalen", anzahl: 1 },
    ]);
    expect(top).toEqual({ name: "BW", anzahl: 7 });
  });
});

describe("germanPostalCode / plzToBundesland", () => {
  it("nimmt nur fünfstellige deutsche PLZ", () => {
    expect(germanPostalCode("50667")).toBe("50667");
    expect(germanPostalCode("D-50667")).toBe("50667");
    expect(plzToBundesland("50667")).toBe("nordrhein-westfalen");
    expect(plzToBundesland("D-50667")).toBe("nordrhein-westfalen");
  });

  it("liest AT/CH-PLZ nicht als deutsche Präfixe", () => {
    expect(germanPostalCode("1010")).toBeNull();
    expect(germanPostalCode("8001")).toBeNull();
    expect(plzToBundesland("1010")).toBe("unbekannt");
    expect(plzToBundesland("8001")).toBe("unbekannt");
    expect(plzToBundesland("10")).toBe("unbekannt");
  });
});
