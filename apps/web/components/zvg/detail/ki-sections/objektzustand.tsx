import { KiSection } from "@/components/zvg/detail/ki-section";
import { cn } from "@/lib/utils";

interface ObjektzustandProps {
  denkmalschutz?: boolean | null;
  innenbesichtigung?: boolean | null;
  vermietet?: boolean | null;
  restnutzungsdauerJ?: number | null;
  heizung?: string | null;
  wohnraeume?: string | null;
  gebaeudenutzungen?: Array<{ typ: string; beschreibung: string }> | null;
  zustandAussen?: string | null;
  zustandInnen?: string | null;
  maengelKurz?: string | null;
}

function StatusBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: "green" | "amber" | "red" | "gray";
}) {
  const styles = {
    green:
      "bg-[var(--success-container)] text-[var(--success-container-fg)] border-[var(--success)]/30",
    amber:
      "bg-[var(--warning-container)] text-[var(--warning-container-fg)] border-[var(--warning)]/30",
    red: "bg-[var(--error-container)] text-[var(--error-container-fg)] border-[var(--destructive)]/30",
    gray: "bg-muted/50 text-foreground border-border",
  };
  return (
    <div className={cn("border rounded-[4px] p-3 text-center", styles[variant])}>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

export function ObjektzustandSection({
  denkmalschutz,
  innenbesichtigung,
  vermietet,
  restnutzungsdauerJ,
  heizung,
  wohnraeume,
  gebaeudenutzungen,
  zustandAussen,
  zustandInnen,
  maengelKurz,
}: ObjektzustandProps) {
  return (
    <KiSection num="09" title="Objektzustand" severity="info">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatusBox
          label="Denkmalschutz"
          value={denkmalschutz == null ? "—" : denkmalschutz ? "Ja" : "Nein"}
          variant={denkmalschutz ? "amber" : "gray"}
        />
        <StatusBox
          label="Innenbesichtigung"
          value={innenbesichtigung == null ? "—" : innenbesichtigung ? "Ja" : "Nein"}
          variant={innenbesichtigung ? "green" : "red"}
        />
        <StatusBox
          label="Vermietet"
          value={vermietet == null ? "—" : vermietet ? "Ja" : "Nein"}
          variant={vermietet ? "amber" : "green"}
        />
        <StatusBox
          label="Restnutzungsdauer"
          value={restnutzungsdauerJ ? `${restnutzungsdauerJ} Jahre` : "—"}
          variant="gray"
        />
      </div>

      <dl className="flex flex-col gap-3 mb-5">
        {heizung && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <dt className="text-sm text-muted-foreground font-medium">Heizung</dt>
            <dd className="text-sm text-foreground sm:col-span-2">{heizung}</dd>
          </div>
        )}
        {wohnraeume && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <dt className="text-sm text-muted-foreground font-medium">Wohnräume</dt>
            <dd className="text-sm text-foreground sm:col-span-2">{wohnraeume}</dd>
          </div>
        )}
      </dl>

      {gebaeudenutzungen && gebaeudenutzungen.length > 0 && (
        <div className="mb-5">
          <h4 className="text-sm font-semibold text-foreground mb-3">Gebäudenutzungsarten</h4>
          <div className="flex flex-col gap-2">
            {gebaeudenutzungen.map((n, i) => (
              <div key={i} className="bg-muted/50 border border-border rounded-[4px] p-3">
                <div className="flex items-start gap-2">
                  <div className="size-2 bg-primary rounded-full mt-2 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{n.typ}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.beschreibung}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {zustandAussen && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-foreground mb-1">Zustand Außen</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">{zustandAussen}</p>
        </div>
      )}
      {zustandInnen && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-foreground mb-1">Zustand Innen</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">{zustandInnen}</p>
        </div>
      )}
      {maengelKurz && (
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-1">Mängel (Kurz)</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">{maengelKurz}</p>
        </div>
      )}
    </KiSection>
  );
}
