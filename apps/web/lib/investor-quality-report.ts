import { fetchAllActiveInvestorRows } from "@/lib/investor-queries";
import { fetchDatenbasis } from "@/lib/datenbasis";
import { INVESTOR_QUALITY_RULES_VERSION } from "@/lib/investor-quality";
import { rowToInvestorPick } from "@/lib/investor-picks";
import { aggregateInvestorQuality } from "@/lib/investor-monitoring";
import { UNDERWRITING_VERSION } from "@/lib/underwriting";

export async function generateInvestorQualityReport() {
  const [rows, basis] = await Promise.all([fetchAllActiveInvestorRows(), fetchDatenbasis()]);
  const picks = rows.map((row) => rowToInvestorPick(row, "all"));

  const baseReport = aggregateInvestorQuality(
    picks.map((pick) => ({ quality: pick.quality, chance: pick.chance })),
  );

  return {
    report: {
      ...baseReport,
      // Dieselben Zahlen wie auf der Datenbasis-Seite, damit jeder Lauf einen
      // vergleichbaren Abdeckungsstand festhält statt einer eigenen Definition.
      // Die Grundgesamtheit wandert mit: ohne sie liest sich eine geänderte
      // Bezugsmenge im Verlauf wie ein Fortschritt.
      abdeckung: basis.abdeckung.map(({ merkmal, anzahl, gesamt, grundgesamtheit }) => ({
        merkmal,
        anzahl,
        gesamt,
        grundgesamtheit,
      })),
    },
    versions: {
      qualityRules: INVESTOR_QUALITY_RULES_VERSION,
      underwriting: UNDERWRITING_VERSION,
    },
  };
}
