import { KiSection, KiFinding } from "@/components/zvg/detail/ki-section";

interface Flurstueck {
  nummer?: string;
  grundbuch?: string;
  blatt?: string;
  gemarkung?: string;
  wirtschaftsart?: string;
  [key: string]: unknown;
}

export function GrundbuchSection({
  blatt,
  flurstueck,
  gemarkung,
  flurstuecke,
}: {
  blatt: string | null;
  flurstueck: string | null;
  gemarkung: string | null;
  flurstuecke: Flurstueck[];
}) {
  const hasData = blatt || flurstueck || gemarkung || flurstuecke.length > 0;
  const summary = hasData
    ? [gemarkung, blatt ? `Blatt ${blatt}` : null, flurstueck ? `Flst. ${flurstueck}` : null]
        .filter(Boolean)
        .join(" · ")
    : "Keine Grundbuchdaten";

  return (
    <KiSection
      num="01"
      title="Grundbuch · Flurstück & Gemarkung"
      severity={hasData ? "ok" : "warn"}
      summary={summary}
      defaultOpen={!!hasData}
    >
      {hasData ? (
        <div className="space-y-2">
          {gemarkung && <KiFinding tag="Gemarkung" text={gemarkung} severity="info" />}
          {blatt && <KiFinding tag="Grundbuchblatt" text={blatt} severity="info" />}
          {flurstueck && <KiFinding tag="Flurstück" text={flurstueck} severity="info" />}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Keine Grundbuchdaten aus dem Gutachten extrahierbar.
        </p>
      )}

      {flurstuecke.length > 0 && (
        <div className="mt-3 space-y-1">
          {flurstuecke.map((f, i) => (
            <div
              key={i}
              className="text-xs text-muted-foreground font-mono border-b border-border/50 pb-1"
            >
              {f.nummer && <span className="mr-2 font-semibold">{f.nummer}</span>}
              {f.wirtschaftsart && <span>{f.wirtschaftsart}</span>}
              {f.gemarkung && <span className="ml-2 opacity-70">{f.gemarkung}</span>}
            </div>
          ))}
        </div>
      )}
    </KiSection>
  );
}
