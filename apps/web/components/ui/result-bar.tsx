import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ResultBar({
  count,
  shown,
  unit = "Treffer",
  chips,
  trailing,
  className,
}: {
  count: number;
  shown?: number;
  unit?: string;
  chips?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const totalLabel = count.toLocaleString("de-DE");
  const label =
    shown != null && shown !== count
      ? `${shown.toLocaleString("de-DE")} von ${totalLabel} ${unit}`
      : `${totalLabel} ${unit}`;

  return (
    <div className={cn("flex items-center justify-between gap-3 flex-wrap py-2", className)}>
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="font-mono text-xs text-foreground">{label}</span>
        {chips ? (
          <span className="flex items-center gap-1.5 flex-wrap text-muted-foreground">{chips}</span>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

export function ResultChip({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] text-muted-foreground border border-border rounded-[4px] px-1.5 py-0.5">
      {children}
    </span>
  );
}
