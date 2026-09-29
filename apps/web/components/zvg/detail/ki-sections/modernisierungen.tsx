import { KiSection } from "@/components/zvg/detail/ki-section";

interface Modernisierung {
  jahr: number;
  beschreibung: string;
}

export function ModernisierungenSection({
  modernisierungen,
}: {
  modernisierungen: Modernisierung[];
}) {
  if (!modernisierungen || modernisierungen.length === 0) return null;

  const sorted = [...modernisierungen].sort((a, b) => b.jahr - a.jahr);
  const summary = `${modernisierungen.length} Maßnahmen`;

  return (
    <KiSection num="07" title="Modernisierungen" severity="info" summary={summary}>
      <div className="relative pl-5">
        <div className="absolute left-2 top-1 bottom-1 w-px bg-[var(--success)]/30" />
        <ul className="flex flex-col gap-3">
          {sorted.map((m, i) => (
            <li key={i} className="relative flex items-start gap-3">
              <div className="absolute -left-3 mt-1.5 size-2.5 rounded-full bg-[var(--success)] border-2 border-background shadow shrink-0" />
              <div className="min-w-0 rounded-[4px] border border-[var(--success)]/20 bg-[var(--success-container)] px-3 py-2">
                <p className="text-xs font-bold text-[var(--success-container-fg)]">{m.jahr}</p>
                <p className="mt-0.5 text-sm text-[var(--success-container-fg)]/90 leading-snug">
                  {m.beschreibung}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </KiSection>
  );
}
