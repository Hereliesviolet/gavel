"use client";

import { MapPin, Landmark, Hash, Building2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchSuggestions } from "@/app/api/search-suggestions/route";
import {
  flattenSuggestions,
  SUGGESTION_GROUP_LABELS,
  SUGGESTION_GROUP_ORDER,
  type FlatSuggestionItem,
} from "@/lib/search-suggestions";

const GROUP_ICONS: Record<FlatSuggestionItem["type"], LucideIcon> = {
  ort: MapPin,
  amtsgericht: Landmark,
  plz: Hash,
  listing: Building2,
};

interface SuggestionsDropdownProps {
  suggestions: SearchSuggestions;
  activeKey: string | null;
  onHover: (key: string) => void;
  onSelect: (item: FlatSuggestionItem) => void;
}

export function SuggestionsDropdown({
  suggestions,
  activeKey,
  onHover,
  onSelect,
}: SuggestionsDropdownProps) {
  const items = flattenSuggestions(suggestions);
  if (items.length === 0) return null;

  const groups = SUGGESTION_GROUP_ORDER.map((type) => ({
    type,
    items: items.filter((item) => item.type === type),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="py-1">
      {groups.map((group, groupIndex) => (
        <div key={group.type} className={cn(groupIndex > 0 && "mt-1 border-t border-border pt-1")}>
          <div className="px-3 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {SUGGESTION_GROUP_LABELS[group.type]}
          </div>
          {group.items.map((item) => {
            const Icon = GROUP_ICONS[item.type];
            const active = item.key === activeKey;
            return (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => onHover(item.key)}
                onClick={() => onSelect(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.label}</span>
                {item.type === "listing" && item.sublabel && (
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                    {item.sublabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
