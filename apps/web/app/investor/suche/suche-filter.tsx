"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  applyPreset,
  parseFinderFiltersFromSearchParams,
  type FinderPreset,
} from "@/lib/investor-finder";
import { BUNDESLAENDER } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STRATEGIE_PRESETS: { id: FinderPreset; label: string }[] = [
  { id: "fix-flip", label: "Fix & Flip" },
  { id: "buy-hold", label: "Buy & Hold" },
  { id: "unter-markt", label: "Preisabweichung" },
  { id: "zeitnah", label: "Zeitnaher Termin" },
];

const PAKET_PRESETS: { id: FinderPreset; label: string }[] = [
  { id: "einsteiger-paket", label: "Einsteiger-Paket" },
  { id: "flip-unter-150k", label: "Flip unter 150k" },
  { id: "cashflow-nrw", label: "Cashflow NRW" },
];

export function SucheFilter({ total, shown }: { total: number; shown: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void, debounce = false, resetOffset = true) => {
      const run = () => {
        const params = new URLSearchParams(searchParams.toString());
        mutate(params);
        if (resetOffset) params.delete("offset");
        startTransition(() => {
          router.replace(`/investor/suche?${params.toString()}`);
        });
      };
      if (debounce) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(run, 400);
      } else {
        run();
      }
    },
    [router, searchParams],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const effective = applyPreset(parseFinderFiltersFromSearchParams(raw));
  const bundesland = effective.bundesland?.[0] ?? "";
  const vwMin = effective.vwMin != null ? String(effective.vwMin) : "";
  const vwMax = effective.vwMax != null ? String(effective.vwMax) : "";
  const preset = searchParams.get("preset") ?? "";
  const terminMax = effective.terminMaxDays != null ? String(effective.terminMaxDays) : "";
  const excludeHardRisk = effective.excludeHardRisk === true;
  const pageSize = effective.limit ?? 20;
  const offset = effective.offset ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.floor(offset / pageSize) + 1;

  const setzePreset = (id: FinderPreset) =>
    updateParams((params) => {
      if (params.get("preset") === id) params.delete("preset");
      else params.set("preset", id);
      // Die Strategie steckt im Preset; ein alter Strategie-Parameter würde
      // sie sonst still überschreiben.
      params.delete("strategy");
    });

  return (
    <aside
      className={cn(
        "lg:sticky lg:top-28 space-y-5 rounded-[4px] border border-border bg-card p-4 h-fit",
        pending && "opacity-70",
      )}
    >
      <p className="font-mono text-xs text-foreground">
        {shown < total
          ? `${shown.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")} Treffer`
          : `${total.toLocaleString("de-DE")} Treffer`}
      </p>

      <div className="space-y-2">
        <p className="label-mono">Strategie</p>
        <div className="flex flex-wrap gap-1.5">
          {STRATEGIE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setzePreset(p.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                preset === p.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:border-foreground/30",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="label-mono">Pakete</p>
        <div className="flex flex-wrap gap-1.5">
          {PAKET_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setzePreset(p.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                preset === p.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:border-foreground/30",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Bundesland</span>
        <select
          value={bundesland}
          onChange={(e) =>
            updateParams((params) => {
              if (e.target.value) params.set("bundesland", e.target.value);
              else params.delete("bundesland");
            })
          }
          className="h-9 rounded-[4px] border border-border bg-background px-2 text-sm"
        >
          <option value="">Alle</option>
          {BUNDESLAENDER.map((bl) => (
            <option key={bl.slug} value={bl.slug}>
              {bl.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">VW ab (€)</span>
          <input
            key={`vwmin-${preset}-${vwMin}`}
            type="number"
            defaultValue={vwMin}
            onChange={(e) =>
              updateParams((params) => {
                if (e.target.value) params.set("vw_min", e.target.value);
                else params.delete("vw_min");
              }, true)
            }
            className="h-9 rounded-[4px] border border-border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">VW bis (€)</span>
          <input
            key={`vwmax-${preset}-${vwMax}`}
            type="number"
            defaultValue={vwMax}
            onChange={(e) =>
              updateParams((params) => {
                if (e.target.value) params.set("vw_max", e.target.value);
                else params.delete("vw_max");
              }, true)
            }
            className="h-9 rounded-[4px] border border-border bg-background px-2 text-sm"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Termin innerhalb (Tage)</span>
        <input
          type="number"
          min={1}
          key={`termin-${preset}-${terminMax}`}
          defaultValue={terminMax}
          onChange={(e) =>
            updateParams((params) => {
              if (e.target.value) params.set("termin_max", e.target.value);
              else params.delete("termin_max");
            }, true)
          }
          className="h-9 rounded-[4px] border border-border bg-background px-2 text-sm"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={excludeHardRisk}
          onChange={(e) =>
            updateParams((params) => {
              if (e.target.checked) params.set("no_hard_risk", "1");
              else params.delete("no_hard_risk");
            })
          }
        />
        Objekte mit Anti-Signal ausblenden
      </label>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() =>
              updateParams(
                (params) => {
                  const next = Math.max(0, offset - pageSize);
                  if (next > 0) params.set("offset", String(next));
                  else params.delete("offset");
                },
                false,
                false,
              )
            }
          >
            ← Zurück
          </Button>
          <span className="font-mono text-[11px] text-muted-foreground">
            {page} / {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() =>
              updateParams(
                (params) => {
                  params.set("offset", String(offset + pageSize));
                },
                false,
                false,
              )
            }
          >
            Weiter →
          </Button>
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => startTransition(() => router.replace("/investor/suche"))}
      >
        Filter zurücksetzen
      </Button>
    </aside>
  );
}
