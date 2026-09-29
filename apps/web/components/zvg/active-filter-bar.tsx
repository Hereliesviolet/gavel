"use client";

import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActiveFilter {
  key: string;
  label: string;
}

/**
 * Sticky toolbar zwischen Header und Listing-Inhalt.
 * Zeigt aktive Filter als entfernbare Chips, Sortierung rechts, plus
 * "Alert speichern".
 */
export function ActiveFilterBar({
  filters,
  totalCount,
  onRemove,
  onClearAll,
  onAddFilter,
  sortLabel = "Termin · aufsteigend",
  onSortChange,
  onSaveAlert,
  className,
}: {
  filters: ActiveFilter[];
  totalCount?: number;
  onRemove?: (key: string) => void;
  onClearAll?: () => void;
  onAddFilter?: () => void;
  sortLabel?: string;
  onSortChange?: () => void;
  onSaveAlert?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap px-6 py-2 border-b border-border bg-[var(--surface-toolbar)] text-xs sticky top-0 z-20",
        className,
      )}
    >
      <span className="label-mono pr-1">Aktiv</span>

      {filters.length === 0 && <span className="text-muted-foreground italic">Keine Filter</span>}

      {filters.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => onRemove?.(f.key)}
          className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 bg-[var(--primary-container)] text-[var(--primary-container-fg)] rounded-[4px] hover:opacity-80 transition-opacity"
        >
          <span>{f.label}</span>
          <X className="size-3 opacity-70" />
        </button>
      ))}

      {onAddFilter && (
        <button
          type="button"
          onClick={onAddFilter}
          className="inline-flex items-center gap-1 px-2 py-0.5 border border-dashed border-border rounded-[4px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
        >
          <Plus className="size-3" /> Filter
        </button>
      )}

      {filters.length > 0 && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-muted-foreground hover:text-foreground transition-colors ml-1"
        >
          Alle entfernen
        </button>
      )}

      <span className="flex-1" />

      {totalCount != null && (
        <span className="font-mono text-[11px] text-muted-foreground">
          {totalCount.toLocaleString("de-DE")} Treffer
        </span>
      )}

      <button
        type="button"
        onClick={onSortChange}
        className="px-2.5 py-1 border border-border rounded-[4px] font-mono text-[11px] hover:border-foreground/40 transition-colors"
      >
        {sortLabel} ▾
      </button>

      {onSaveAlert && (
        <button
          type="button"
          onClick={onSaveAlert}
          className="text-primary hover:underline text-xs"
        >
          + Alert speichern
        </button>
      )}
    </div>
  );
}
