"use client";

import { type AnalysePreview } from "@/lib/analyse-jobs";
import { formatCurrency, cn } from "@/lib/utils";
import { PreisBewertungIcon, PREIS_BEWERTUNG_LABEL } from "@/components/analyse/preis-bewertung";
import { ScoreBadge } from "@/components/investor/score-badge";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-[4px] bg-graphite h-3", className)} />;
}

function formatFlaeche(m2: number): string {
  return `${m2.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m²`;
}

function previewHeadline(preview: AnalysePreview): string {
  const parts: string[] = [];
  if (preview.typ?.trim()) parts.push(preview.typ.trim());
  if (preview.zimmer != null) parts.push(`${preview.zimmer} Zi`);
  if (preview.flaecheM2 != null) parts.push(formatFlaeche(preview.flaecheM2));
  if (preview.ort?.trim()) parts.push(preview.ort.trim());
  return parts.join(" · ") || "Objekt";
}

export function AnalysePreviewPanel({
  preview,
  active,
}: {
  preview: AnalysePreview | null;
  active: boolean;
}) {
  const hasAny =
    preview &&
    (preview.typ ||
      preview.preis != null ||
      preview.zimmer != null ||
      preview.flaecheM2 != null ||
      preview.ort ||
      preview.preisBewertung ||
      (preview.investmentScore && preview.angebotstyp === "kauf"));

  return (
    <div className="rounded-[4px] border border-border bg-graphite/30 px-3 py-3 mb-3">
      {!hasAny ? (
        <div className="space-y-2">
          <Skeleton className="w-3/4 h-4" />
          <Skeleton className="w-1/2" />
          <Skeleton className="w-2/5" />
          {active && (
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground pt-1">
              Daten folgen…
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p
            className={cn(
              "font-mono text-xs text-foreground leading-snug",
              "animate-in fade-in slide-in-from-bottom-1 duration-200",
            )}
          >
            {previewHeadline(preview)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            {preview?.preis != null && (
              <span className="text-foreground animate-in fade-in duration-200">
                {formatCurrency(preview.preis)}
                {preview.angebotstyp === "miete" ? " / Monat" : ""}
              </span>
            )}
            {preview?.preisProM2 != null && (
              <span className="animate-in fade-in duration-200 delay-75">
                {formatCurrency(preview.preisProM2)}
                {preview.angebotstyp === "miete" ? "/m² · Miete" : "/m²"}
              </span>
            )}
            {preview?.bildCount != null && preview.bildCount > 0 && (
              <span className="animate-in fade-in duration-200 delay-100">
                {preview.bildCount} Fotos
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {preview?.preisBewertung && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em]",
                  "text-muted-foreground animate-in fade-in duration-200 delay-200",
                )}
              >
                <PreisBewertungIcon bewertung={preview.preisBewertung} />
                {PREIS_BEWERTUNG_LABEL[preview.preisBewertung] ?? preview.preisBewertung}
              </span>
            )}
            {preview?.investmentScore && preview.angebotstyp === "kauf" && (
              <span className="animate-in fade-in duration-200 delay-300">
                <ScoreBadge score={preview.investmentScore} variant="investment" />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
