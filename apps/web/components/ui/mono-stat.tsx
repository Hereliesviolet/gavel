import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Label + großer mono-Wert + optionaler Sub-Text.
 * Wird benutzt für KPI-Cards, Key-Facts, Ticker-Cells.
 */
export function MonoStat({
  label,
  value,
  unit,
  sub,
  className,
  size = "md",
  trailing,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const valueSize = {
    sm: "text-base",
    md: "text-lg",
    lg: "text-2xl",
    xl: "text-3xl",
  }[size];

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-mono">{label}</span>
        {trailing}
      </div>
      <div
        className={cn(
          "font-mono font-semibold tracking-tight text-foreground leading-[1.05] mt-1",
          valueSize,
        )}
      >
        {value}
        {unit ? (
          <span className="text-muted-foreground font-normal text-[0.65em] ml-1">{unit}</span>
        ) : null}
      </div>
      {sub ? (
        <span className="font-mono text-[11px] text-muted-foreground mt-0.5">{sub}</span>
      ) : null}
    </div>
  );
}
