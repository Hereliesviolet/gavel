import { describe, expect, it } from "vitest";
import { parseDataFreshnessAlert } from "@/lib/data-freshness";

const valid = {
  aktiveObjekte: 12,
  letzterSchreibzeitpunkt: "12.09.2026 08:00",
  alterMinuten: 40,
  schwelleStunden: 26,
};

describe("parseDataFreshnessAlert", () => {
  it("nimmt gültige Messwerte", () => {
    expect(parseDataFreshnessAlert(valid)).toEqual(valid);
  });

  it("erlaubt fehlenden Zeitstempel", () => {
    expect(
      parseDataFreshnessAlert({
        aktiveObjekte: 0,
        letzterSchreibzeitpunkt: null,
        alterMinuten: null,
        schwelleStunden: 26,
      }),
    ).toEqual({
      aktiveObjekte: 0,
      letzterSchreibzeitpunkt: null,
      alterMinuten: null,
      schwelleStunden: 26,
    });
  });

  it("lehnt unplausible oder nicht-numerische Felder ab", () => {
    expect(parseDataFreshnessAlert({ ...valid, aktiveObjekte: -1 })).toBeNull();
    expect(parseDataFreshnessAlert({ ...valid, schwelleStunden: 0 })).toBeNull();
    expect(parseDataFreshnessAlert({ ...valid, schwelleStunden: 200 })).toBeNull();
    expect(parseDataFreshnessAlert({ ...valid, alterMinuten: "40" })).toBeNull();
    expect(parseDataFreshnessAlert({ aktiveObjekte: 1 })).toBeNull();
    expect(parseDataFreshnessAlert(null)).toBeNull();
  });
});
