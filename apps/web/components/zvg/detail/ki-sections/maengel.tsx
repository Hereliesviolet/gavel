import { KiSection, KiFinding } from "@/components/zvg/detail/ki-section";
import type { SeverityLevel } from "@/components/ui/severity";

// Zwei Schreibweisen im Umlauf (siehe Vorab-Fix 2026-07-08,
// scrapers/src/models/zvg.py::Mangel): alte KI-Läufe liefern
// {nummer, schweregrad: "Hoch"|"Mittel"|"Niedrig", beschreibung} ohne
// raum/kosten, neue Läufe {nummer, raum, schwere: "leicht"|"mittel"|"schwer",
// beschreibung, kosten_eur}. Diese Komponente akzeptiert beide Formen und
// normalisiert case-insensitiv, damit alte gespeicherte Analysen nicht
// crashen oder leer/falsch angezeigt werden.
export interface Mangel {
  raum?: string | null;
  schwere?: string | null;
  schweregrad?: string | null;
  beschreibung: string;
  kosten?: number | null;
  kosten_eur?: number | null;
}

type NormalizedSchwere = "leicht" | "mittel" | "schwer";

const SCHWERE_MAP: Record<NormalizedSchwere, SeverityLevel> = {
  leicht: "ok",
  mittel: "warn",
  schwer: "err",
};

// Deckt sowohl die neuen (leicht/mittel/schwer) als auch die alten
// (Hoch/Mittel/Niedrig) Werte ab, unabhängig von Groß-/Kleinschreibung.
const VALUE_ALIASES: Record<string, NormalizedSchwere> = {
  leicht: "leicht",
  niedrig: "leicht",
  mittel: "mittel",
  schwer: "schwer",
  hoch: "schwer",
};

function normalizeSchwere(m: Mangel): NormalizedSchwere {
  const raw = (m.schwere ?? m.schweregrad ?? "").toLowerCase();
  return VALUE_ALIASES[raw] ?? "mittel";
}

function getKosten(m: Mangel): number | null | undefined {
  return m.kosten_eur ?? m.kosten;
}

export function MaengelSection({ maengel }: { maengel: Mangel[] }) {
  const normalized = maengel.map((m) => ({ m, schwere: normalizeSchwere(m) }));
  const cnt = (s: NormalizedSchwere) => normalized.filter((n) => n.schwere === s).length;

  const summary = `${cnt("leicht")} leicht · ${cnt("mittel")} mittel · ${cnt("schwer")} schwer`;
  const sev: SeverityLevel = cnt("schwer") > 0 ? "err" : cnt("mittel") > 0 ? "warn" : "ok";

  return (
    <KiSection
      num="02"
      title="Mängel & Instandhaltung"
      severity={sev}
      summary={summary}
      defaultOpen
    >
      <p className="text-sm text-foreground/90 leading-relaxed max-w-prose">
        Auswertung Verkehrswertgutachten. Ergänzt durch Sichtprüfung der Fotodokumentation.
        Kostenangaben sind grobe Schätzungen ohne Mengen-/Materialaufmaß.
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        {normalized.map(({ m, schwere }, i) => {
          const kosten = getKosten(m);
          return (
            <KiFinding
              key={i}
              tag={[schwere.toUpperCase(), m.raum?.toUpperCase()].filter(Boolean).join(" · ")}
              text={m.beschreibung}
              severity={SCHWERE_MAP[schwere]}
              amount={kosten != null ? `~ ${kosten.toLocaleString("de-DE")} €` : undefined}
            />
          );
        })}
      </div>
    </KiSection>
  );
}
