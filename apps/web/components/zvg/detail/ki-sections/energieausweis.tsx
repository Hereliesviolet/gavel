import { KiSection } from "@/components/zvg/detail/ki-section";
import { EnergieSkala, type EnergieKlasse } from "@/components/ui/energie-skala";

export function EnergieausweisSection({
  vorhanden,
  effizienzklasse,
  ausweisjahr,
  energietraeger,
  endenergieverbrauchKwh,
}: {
  vorhanden: boolean | null;
  effizienzklasse: string | null;
  ausweisjahr: number | null;
  energietraeger: string | null;
  endenergieverbrauchKwh: string | null;
}) {
  const kwh = endenergieverbrauchKwh ? parseFloat(endenergieverbrauchKwh) : null;
  const klasse = (effizienzklasse as EnergieKlasse | null) ?? "G";
  const summary = effizienzklasse
    ? `Klasse ${effizienzklasse}${kwh ? ` · ${kwh} kWh/m²·a` : ""}${ausweisjahr ? ` (${ausweisjahr})` : ""}`
    : vorhanden === false
      ? "Kein Ausweis vorhanden"
      : "Unbekannt";

  return (
    <KiSection
      num="03"
      title="Energieausweis"
      severity={effizienzklasse ? "info" : "warn"}
      summary={summary}
    >
      {vorhanden === false ? (
        <p className="text-sm text-muted-foreground">
          Laut Gutachten kein Energieausweis vorhanden oder nicht vorgelegt.
        </p>
      ) : effizienzklasse || kwh ? (
        <div className="space-y-3">
          {energietraeger && (
            <p className="text-sm text-muted-foreground">
              Energieträger: <span className="text-foreground">{energietraeger}</span>
              {ausweisjahr ? ` · Ausgestellt ${ausweisjahr}` : ""}
            </p>
          )}
          {kwh != null && <EnergieSkala klasse={klasse} kwh={kwh} className="mt-2" />}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Keine Energieausweis-Daten aus dem Gutachten extrahierbar.
        </p>
      )}
    </KiSection>
  );
}
