import { KiSection } from "@/components/zvg/detail/ki-section";
import { Car, Footprints } from "lucide-react";

interface Ort {
  name: string;
  adresse: string;
  kategorie: string;
  bewertung?: number | null;
  bewertungen_anzahl?: number | null;
  entfernung_pkw_m?: number | null;
  dauer_pkw_min?: number | null;
  entfernung_fuss_m?: number | null;
  dauer_fuss_min?: number | null;
}

const KATEGORIE_ICON: Record<string, string> = {
  Supermarkt: "🛒",
  Schule: "🏫",
  ÖPNV: "🚌",
  Krankenhaus: "🏥",
  Apotheke: "💊",
  Restaurant: "🍽️",
  Park: "🌳",
};

function formatDistance(m?: number | null) {
  if (!m) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export function OrteInDerNaeheSection({ orte }: { orte: Ort[] }) {
  if (!orte || orte.length === 0) return null;

  return (
    <KiSection num="08" title="Orte in der Nähe" severity="info" summary={`${orte.length} Orte`}>
      <div className="flex flex-col gap-3">
        {orte.map((ort, i) => (
          <div key={i} className="bg-muted/50 border border-border rounded-[4px] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">{KATEGORIE_ICON[ort.kategorie] ?? "📍"}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{ort.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{ort.kategorie}</p>
                  {ort.adresse && (
                    <p className="text-xs text-muted-foreground truncate">{ort.adresse}</p>
                  )}
                </div>
              </div>
              {ort.bewertung && (
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-[var(--warning)]">
                    ★ {ort.bewertung.toFixed(1)}
                  </p>
                  {ort.bewertungen_anzahl && (
                    <p className="text-xs text-muted-foreground">({ort.bewertungen_anzahl})</p>
                  )}
                </div>
              )}
            </div>

            {(ort.entfernung_pkw_m || ort.entfernung_fuss_m) && (
              <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border">
                {ort.entfernung_pkw_m && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Car className="size-3" />
                    <span>{formatDistance(ort.entfernung_pkw_m)}</span>
                    {ort.dauer_pkw_min && <span>({ort.dauer_pkw_min} min)</span>}
                  </div>
                )}
                {ort.entfernung_fuss_m && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Footprints className="size-3" />
                    <span>{formatDistance(ort.entfernung_fuss_m)}</span>
                    {ort.dauer_fuss_min && <span>({ort.dauer_fuss_min} min)</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </KiSection>
  );
}
