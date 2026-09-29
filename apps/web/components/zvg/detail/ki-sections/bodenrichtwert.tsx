import { KiSection } from "@/components/zvg/detail/ki-section";

interface BodenrichtwertProps {
  eurM2?: string | null;
  stichtag?: string | null;
  berechnung?: string | null;
}

export function BodenrichtwertSection({ eurM2, stichtag, berechnung }: BodenrichtwertProps) {
  if (!eurM2 && !berechnung) return null;

  const summary = eurM2 ? `${eurM2} €/m²` : undefined;

  return (
    <KiSection num="06" title="Bodenrichtwert" severity="info" summary={summary}>
      <div className="bg-accent border border-border rounded-[4px] p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {eurM2 && (
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Bodenrichtwert</p>
              <p className="font-bold text-primary text-lg">{eurM2} €/m²</p>
            </div>
          )}
          {berechnung && (
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Berechnung</p>
              <p className="font-medium text-foreground">{berechnung}</p>
            </div>
          )}
          {stichtag && (
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Stichtag</p>
              <p className="font-medium text-foreground">{stichtag}</p>
            </div>
          )}
        </div>
      </div>
    </KiSection>
  );
}
