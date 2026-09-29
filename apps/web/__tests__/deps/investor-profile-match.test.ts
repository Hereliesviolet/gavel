import { describe, expect, it } from "vitest";
import {
  intersectFinderBundeslaender,
  matchesInvestorProfile,
  selectDeskPickStrategy,
} from "@/lib/investor-profile-match";

describe("matchesInvestorProfile", () => {
  it("lässt ohne Profil alles durch", () => {
    expect(matchesInvestorProfile({ listing: { bundesland: "bayern", kategorie: "haus" } })).toBe(
      true,
    );
    expect(
      matchesInvestorProfile(
        { listing: { bundesland: "bayern" } },
        { regions: [], propertyTypes: [] },
      ),
    ).toBe(true);
  });

  it("vergleicht Regionen über kanonische Bundesland-Slugs", () => {
    const listing = {
      listing: { bundesland: "Baden-Württemberg", kategorie: "haus" },
    };
    expect(matchesInvestorProfile(listing, { regions: ["badenwuerttemberg"] })).toBe(true);
    expect(matchesInvestorProfile(listing, { regions: ["baden-wuerttemberg"] })).toBe(true);
    expect(matchesInvestorProfile(listing, { regions: ["bayern"] })).toBe(false);
  });

  it("filtert Objektarten über Kategorie oder Typ", () => {
    expect(
      matchesInvestorProfile(
        { listing: { bundesland: "bayern", kategorie: "wohnung", typ: "ETW" } },
        { propertyTypes: ["wohnung"] },
      ),
    ).toBe(true);
    expect(
      matchesInvestorProfile(
        { listing: { bundesland: "bayern", kategorie: "gewerbe", typ: "Büro" } },
        { propertyTypes: ["wohnung"] },
      ),
    ).toBe(false);
    expect(
      matchesInvestorProfile(
        { listing: { bundesland: "bayern", kategorie: null, typ: "Einfamilienhaus" } },
        { propertyTypes: ["haus"] },
      ),
    ).toBe(true);
    expect(
      matchesInvestorProfile(
        {
          listing: {
            bundesland: "bayern",
            kategorie: "wohnung",
            typ: "Wohnung im Mehrfamilienhaus",
          },
        },
        { propertyTypes: ["haus"] },
      ),
    ).toBe(false);
    expect(
      matchesInvestorProfile(
        { listing: { bundesland: "bayern", kategorie: "sonstiges", typ: "Villa" } },
        { propertyTypes: ["haus"] },
      ),
    ).toBe(true);
  });
});

describe("intersectFinderBundeslaender", () => {
  it("schneidet Suchfilter und Profilregionen", () => {
    expect(intersectFinderBundeslaender(["bayern"], ["bayern", "hessen"])).toEqual({
      kind: "slugs",
      slugs: ["bayern"],
    });
    expect(intersectFinderBundeslaender(["bayern"], ["hessen"])).toEqual({
      kind: "none",
    });
    expect(intersectFinderBundeslaender(undefined, ["NRW"])).toEqual({
      kind: "slugs",
      slugs: ["nordrhein-westfalen"],
    });
    expect(intersectFinderBundeslaender(["bayern"], undefined)).toEqual({
      kind: "slugs",
      slugs: ["bayern"],
    });
    expect(intersectFinderBundeslaender(undefined, undefined)).toEqual({
      kind: "unrestricted",
    });
  });
});

describe("selectDeskPickStrategy", () => {
  const scores = { fix_flip: 40, buy_hold: 80, unter_markt: 55 };

  it("nimmt die gespeicherte Strategie, sonst die höchste Chance", () => {
    expect(selectDeskPickStrategy((s) => scores[s], "fix_flip")).toBe("fix_flip");
    expect(selectDeskPickStrategy((s) => scores[s], "zeitnah")).toBe("buy_hold");
    expect(selectDeskPickStrategy((s) => scores[s])).toBe("buy_hold");
  });
});
