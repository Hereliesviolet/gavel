import { cn } from "@/lib/utils";

export interface KeyFact {
  label: string;
  value: string | number;
  unit?: string;
}

/**
 * Horizontaler Streifen mit 4–6 Eckdaten (Wohnfläche, Zimmer, Etage,
 * Baujahr, Heizung, Energie). Stehen direkt unter der Galerie.
 */
export function KeyFactsStrip({ facts, className }: { facts: KeyFact[]; className?: string }) {
  return (
    <div
      className={cn(
        // Auf schmalen Screens reichen 4-6 Fakten nicht nebeneinander (Text würde
        // abgeschnitten) - daher dort horizontal scrollbar statt gequetscht;
        // ab sm reicht die Breite wieder für das gleichmäßige Grid.
        "flex sm:grid overflow-x-auto overscroll-x-contain border border-border rounded-[4px] bg-[var(--surface-toolbar)]",
        className,
      )}
      style={{
        WebkitOverflowScrolling: "touch",
        gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))`,
      }}
    >
      {facts.map((f, i) => (
        <div
          key={i}
          className={cn(
            "px-3 py-2.5 shrink-0 w-[118px] sm:w-auto",
            i < facts.length - 1 && "border-r border-border",
          )}
        >
          <div className="label-mono mb-0.5">{f.label}</div>
          <div className="font-mono text-base font-semibold tracking-tight leading-tight">
            {f.value}
          </div>
          {f.unit && <div className="text-[11px] text-muted-foreground mt-0.5">{f.unit}</div>}
        </div>
      ))}
    </div>
  );
}
