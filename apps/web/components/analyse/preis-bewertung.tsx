import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export const PREIS_BEWERTUNG_LABEL: Record<string, string> = {
  günstig: "Günstig",
  marktüblich: "Marktüblich",
  teuer: "Teuer",
  unbekannt: "Unbekannt",
};

export function PreisBewertungIcon({ bewertung }: { bewertung: string | null }) {
  if (bewertung === "günstig") return <TrendingDown className="size-4 text-success" />;
  if (bewertung === "teuer") return <TrendingUp className="size-4 text-destructive" />;
  return <Minus className="size-4 text-muted-foreground" />;
}
