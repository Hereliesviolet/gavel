import { KiSection } from "@/components/zvg/detail/ki-section";

interface BauInstandhaltungProps {
  baubeschreibung?: string | null;
  instandhaltung?: string | null;
  baulasten?: string | null;
}

export function BauInstandhaltungSection({
  baubeschreibung,
  instandhaltung,
  baulasten,
}: BauInstandhaltungProps) {
  const hasData = baubeschreibung || instandhaltung || baulasten;
  if (!hasData) return null;

  return (
    <KiSection num="10" title="Bau & Instandhaltung" severity="warn">
      <div className="flex flex-col gap-4">
        {baubeschreibung && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1.5">Baubeschreibung</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{baubeschreibung}</p>
          </div>
        )}
        {instandhaltung && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1.5">Instandhaltung</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{instandhaltung}</p>
          </div>
        )}
        {baulasten && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1.5">Baulasten</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{baulasten}</p>
          </div>
        )}
      </div>
    </KiSection>
  );
}
