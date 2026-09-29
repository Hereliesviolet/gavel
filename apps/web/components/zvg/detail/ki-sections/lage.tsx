import { KiSection } from "@/components/zvg/detail/ki-section";

interface LageProps {
  einwohner?: number | null;
  region?: string | null;
  verkehr?: string | null;
  charakter?: string | null;
  umgebung?: string | null;
}

export function LageSection({ einwohner, region, verkehr, charakter, umgebung }: LageProps) {
  const hasData = einwohner || region || verkehr || charakter || umgebung;
  if (!hasData) return null;

  return (
    <KiSection num="04" title="Lage & Mikrostandort" severity="info" summary={region ?? undefined}>
      <dl className="flex flex-col gap-3">
        {einwohner && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <dt className="text-sm text-muted-foreground font-medium">Einwohner</dt>
            <dd className="text-sm text-foreground sm:col-span-2">
              {einwohner.toLocaleString("de-DE")}
            </dd>
          </div>
        )}
        {region && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <dt className="text-sm text-muted-foreground font-medium">Region</dt>
            <dd className="text-sm text-foreground sm:col-span-2">{region}</dd>
          </div>
        )}
        {verkehr && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <dt className="text-sm text-muted-foreground font-medium">Verkehrsanbindung</dt>
            <dd className="text-sm text-foreground sm:col-span-2">{verkehr}</dd>
          </div>
        )}
        {charakter && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <dt className="text-sm text-muted-foreground font-medium">Charakter</dt>
            <dd className="text-sm text-foreground sm:col-span-2">{charakter}</dd>
          </div>
        )}
        {umgebung && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
            <dt className="text-sm text-muted-foreground font-medium">Umgebung</dt>
            <dd className="text-sm text-foreground sm:col-span-2">{umgebung}</dd>
          </div>
        )}
      </dl>
    </KiSection>
  );
}
