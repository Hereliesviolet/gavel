"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_TERMIN_HORIZON_DAYS } from "@/lib/termin-horizon";

export interface FilterRange {
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
}

export interface FilterChip {
  key: string;
  label: string;
  count?: number;
  active?: boolean;
}

export interface FilterListItem {
  key: string;
  label: string;
  count?: number;
  active?: boolean;
}

export interface FilterState {
  preis: [number, number];
  flaeche: [number, number];
  termin: [number, number];
  kategorien: string[];
  status: string[];
  amtsgerichte: string[];
}

export type FilterPanelProps = {
  value: FilterState;
  onChange: (next: FilterState) => void;
  counts?: {
    kategorien?: Record<string, number>;
    status?: Record<string, number>;
    amtsgerichte?: Record<string, number>;
  };
  amtsgerichte: Array<{ key: string; label: string }>;
  onReset?: () => void;
  className?: string;
};

const KATEGORIEN: FilterChip[] = [
  { key: "wohnung", label: "Wohnung" },
  { key: "haus", label: "Haus" },
  { key: "grundstueck", label: "Grundstück" },
  { key: "gewerbe", label: "Gewerbe" },
];

const STATUS: FilterListItem[] = [
  { key: "neu24", label: "Neu in 24 h" },
  { key: "termin14", label: "Termin < 14 Tage" },
  { key: "vermietet", label: "Vermietet" },
  { key: "denkmalschutz", label: "Denkmalschutz" },
  { key: "ki", label: "Mit KI-Analyse" },
];

const PREIS_SLIDER_MAX = 2_000_000;
const FLAECHE_SLIDER_MAX = 500;

const formatEUR = (v: number) =>
  v >= PREIS_SLIDER_MAX
    ? "beliebig"
    : v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} M €`
      : `${(v / 1_000).toFixed(0)} T €`;

const formatFlaeche = (v: number) => (v >= FLAECHE_SLIDER_MAX ? "beliebig" : `${v} m²`);

export function FilterPanel({
  value,
  onChange,
  counts,
  amtsgerichte,
  onReset,
  className,
}: FilterPanelProps) {
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    onChange({ ...value, [k]: v });

  const toggle = (arr: string[], key: string) =>
    arr.includes(key) ? arr.filter((x) => x !== key) : [...arr, key];

  return (
    <aside
      className={cn(
        "border-r border-border bg-[var(--sidebar)] p-3.5 space-y-4 text-sm",
        className,
      )}
    >
      <Section title="Kategorie" defaultOpen>
        <div className="flex flex-wrap gap-1">
          {KATEGORIEN.map((c) => {
            const active = value.kategorien.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => set("kategorien", toggle(value.kategorien, c.key))}
                className={cn(
                  "text-[11px] px-2 py-1 min-h-8 border rounded-[4px] flex items-center gap-1.5 transition-colors touch-manipulation",
                  active
                    ? "bg-[var(--primary-container)] text-[var(--primary-container-fg)] border-transparent"
                    : "border-border hover:border-foreground/40",
                )}
              >
                {counts?.kategorien?.[c.key] != null && (
                  <span className="font-mono text-[10px] opacity-70">
                    {counts.kategorien[c.key]}
                  </span>
                )}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Verkehrswert" defaultOpen>
        <RangeRow
          range={{ min: 0, max: PREIS_SLIDER_MAX, step: 25_000, format: formatEUR }}
          value={value.preis}
          onChange={(v) => set("preis", v)}
        />
      </Section>

      <Section title="Wohnfläche" defaultOpen>
        <RangeRow
          range={{ min: 0, max: FLAECHE_SLIDER_MAX, step: 10, format: formatFlaeche }}
          value={value.flaeche}
          onChange={(v) => set("flaeche", v)}
        />
      </Section>

      <Section title="Termin im Zeitraum" defaultOpen>
        <RangeRow
          range={{
            min: 0,
            max: DEFAULT_TERMIN_HORIZON_DAYS,
            step: 1,
            format: (v) => (v === 0 ? "Heute" : `+ ${v} T`),
          }}
          value={value.termin}
          onChange={(v) => set("termin", v)}
        />
      </Section>

      <Section title="Status" defaultOpen>
        <div className="flex flex-col gap-1.5">
          {STATUS.map((s) => (
            <CheckboxRow
              key={s.key}
              label={s.label}
              count={counts?.status?.[s.key]}
              checked={value.status.includes(s.key)}
              onChange={() => set("status", toggle(value.status, s.key))}
            />
          ))}
        </div>
      </Section>

      {amtsgerichte.length > 0 && (
        <Section title={`Amtsgericht · ${amtsgerichte.length}`}>
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
            {amtsgerichte.map((ag) => (
              <CheckboxRow
                key={ag.key}
                label={ag.label}
                count={counts?.amtsgerichte?.[ag.key]}
                checked={value.amtsgerichte.includes(ag.key)}
                onChange={() => set("amtsgerichte", toggle(value.amtsgerichte, ag.key))}
              />
            ))}
          </div>
        </Section>
      )}

      <button
        type="button"
        onClick={onReset}
        className="w-full px-3 py-2 min-h-10 border border-border rounded-[4px] text-xs hover:border-foreground/40 transition-colors touch-manipulation"
      >
        Filter zurücksetzen
      </button>
    </aside>
  );
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full py-1 min-h-8 mb-1 label-mono hover:text-foreground transition-colors touch-manipulation"
      >
        <span>{title}</span>
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open && children}
    </div>
  );
}

function RangeRow({
  range,
  value,
  onChange,
}: {
  range: FilterRange;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const fmt = range.format ?? ((v: number) => `${v}${range.unit ?? ""}`);
  return (
    <div>
      <div className="flex justify-between font-mono text-[11px] mb-2">
        <span>{fmt(value[0])}</span>
        <span className="text-muted-foreground">—</span>
        <span>{fmt(value[1])}</span>
      </div>
      <Slider
        min={range.min}
        max={range.max}
        step={range.step ?? 1}
        value={value}
        onValueChange={(v) => onChange(v as [number, number])}
        className="my-2"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
        <span>{fmt(range.min)}</span>
        <span>{fmt(range.max)}</span>
      </div>
    </div>
  );
}

function CheckboxRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className="flex items-center gap-2 text-xs cursor-pointer group py-1.5 -mx-1 px-1 rounded-[4px] min-h-9 touch-manipulation"
      onClick={(e) => {
        e.preventDefault();
        onChange();
      }}
    >
      <span
        className={cn(
          "size-3.5 border rounded-[4px] flex items-center justify-center transition-colors shrink-0",
          checked
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border bg-card group-hover:border-foreground/40",
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-2.5 fill-current">
            <path
              d="M2 6l2.5 2.5L10 3"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="flex-1">{label}</span>
      {count != null && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {count.toLocaleString("de-DE")}
        </span>
      )}
    </label>
  );
}

export function defaultFilterState(): FilterState {
  return {
    preis: [0, PREIS_SLIDER_MAX],
    flaeche: [0, FLAECHE_SLIDER_MAX],
    termin: [0, DEFAULT_TERMIN_HORIZON_DAYS],
    kategorien: [],
    status: [],
    amtsgerichte: [],
  };
}

/** Anzahl der vom Default abweichenden Filter, z.B. für ein Badge auf dem Mobile-Filter-Button. */
export function countActiveFilters(state: FilterState): number {
  const def = defaultFilterState();
  let n = 0;
  if (state.preis[0] !== def.preis[0] || state.preis[1] !== def.preis[1]) n++;
  if (state.flaeche[0] !== def.flaeche[0] || state.flaeche[1] !== def.flaeche[1]) n++;
  if (state.termin[0] !== def.termin[0] || state.termin[1] !== def.termin[1]) n++;
  return n + state.kategorien.length + state.status.length + state.amtsgerichte.length;
}
