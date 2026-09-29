import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type Kategorie = "wohnung" | "haus" | "grundstueck" | "gewerbe" | null | undefined;

const SHORT: Record<NonNullable<Kategorie>, string> = {
  wohnung: "WOHN",
  haus: "HAUS",
  grundstueck: "GRD",
  gewerbe: "GEW",
};

const LABEL: Record<NonNullable<Kategorie>, string> = {
  wohnung: "Wohnung",
  haus: "Haus",
  grundstueck: "Grundstück",
  gewerbe: "Gewerbe",
};

export function kategorieStyle(k: Kategorie): {
  bg: CSSProperties;
  border: CSSProperties;
  fg: CSSProperties;
  borderLeft: CSSProperties;
} {
  if (!k) {
    return {
      bg: {},
      fg: {},
      border: {},
      borderLeft: { borderLeftColor: "var(--border)" },
    };
  }
  return {
    bg: { background: `var(--kat-${k}-container)` },
    fg: { color: `var(--kat-${k})` },
    border: { borderColor: `var(--kat-${k})` },
    borderLeft: { borderLeftColor: `var(--kat-${k})` },
  };
}

export function kategorieShortLabel(k: Kategorie): string {
  return k ? SHORT[k] : "—";
}

export function kategorieLabel(k: Kategorie): string {
  return k ? LABEL[k] : "Sonstiges";
}

/** 3px linker Border in der Kategorie-Farbe. */
export function CategoryAccent({
  kategorie,
  className,
  children,
}: {
  kategorie: Kategorie;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("border-l-[3px]", className)} style={kategorieStyle(kategorie).borderLeft}>
      {children}
    </div>
  );
}

/** Kleines uppercase mono-Tag mit Kategorie-Kürzel. */
export function CategoryTag({
  kategorie,
  className,
}: {
  kategorie: Kategorie;
  className?: string;
}) {
  if (!kategorie) return null;
  return (
    <span
      className={cn(
        "font-mono text-[10px] px-1.5 py-px border border-border tracking-[0.06em] uppercase rounded-[4px] bg-card",
        className,
      )}
      style={kategorieStyle(kategorie).fg}
    >
      {kategorieLabel(kategorie)}
    </span>
  );
}
