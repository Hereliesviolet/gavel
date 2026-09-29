"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SORT_OPTIONS = [
  { value: "neu_zuerst", label: "Neueste zuerst" },
  { value: "termin_asc", label: "Termin: Bald zuerst" },
  { value: "termin_desc", label: "Termin: Spät zuerst" },
  { value: "preis_asc", label: "Preis: Aufsteigend" },
  { value: "preis_desc", label: "Preis: Absteigend" },
  { value: "flaeche_asc", label: "Fläche: Klein → Groß" },
  { value: "flaeche_desc", label: "Fläche: Groß → Klein" },
];

const SORT_LABELS: Record<string, string> = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.value, o.label]),
);

export function SortSelect({ currentSort }: { currentSort: string }) {
  function handleChange(value: string | null) {
    if (!value) return;
    const url = new URL(window.location.href);
    url.searchParams.set("sort", value);
    url.searchParams.delete("page");
    window.location.href = url.toString();
  }

  return (
    <Select defaultValue={currentSort} onValueChange={handleChange}>
      <SelectTrigger className="w-48 min-h-10 touch-manipulation" suppressHydrationWarning>
        {/* Bug-Fix (2026-07-04): @base-ui/react's SelectValue rendert ohne
            eigenen Children-Renderer nur den rohen ausgewählten `value`
            (z.B. "neu_zuerst"), solange das Dropdown noch nie geöffnet
            wurde - das Label aus SelectItem wird nur nach dem ersten
            Öffnen "gelernt". Die Render-Prop-Variante mappt den Wert
            explizit auf das sprechende deutsche Label. */}
        <SelectValue placeholder="Sortierung">
          {(value: string | null) => (value ? (SORT_LABELS[value] ?? value) : "Sortierung")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
