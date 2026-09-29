import { KiBadge } from "@/components/shared/ki-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Belastung {
  nummer: number;
  abteilung: "Abteilung I" | "Abteilung II" | "Abteilung III";
  beschreibung: string;
}

export function BelastungenSection({ belastungen }: { belastungen: Belastung[] }) {
  if (!belastungen || belastungen.length === 0) return null;

  return (
    <Card id="section-belastungen">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-lg">Belastungen</CardTitle>
        <KiBadge />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {belastungen.map((b) => (
          <div key={b.nummer} className="bg-muted/50 border border-border rounded-[4px] p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-foreground">Belastung {b.nummer}</h4>
              <Badge variant="secondary">{b.abteilung}</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{b.beschreibung}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
