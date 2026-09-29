import { MonoStat } from "@/components/ui/mono-stat";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

export interface KpiCardProps {
  label: string;
  value: string;
  trend?: { direction: "up" | "down" | "flat"; pct: string };
  spark?: number[];
  className?: string;
}

export function KpiCard({ label, value, trend, spark, className }: KpiCardProps) {
  const trendColor =
    trend?.direction === "up"
      ? "var(--success)"
      : trend?.direction === "down"
        ? "var(--destructive)"
        : "var(--muted-foreground)";
  const arrow = trend?.direction === "up" ? "↑" : trend?.direction === "down" ? "↓" : "→";

  return (
    <div className={cn("p-4 border-r border-border last:border-r-0", className)}>
      <MonoStat
        label={label}
        value={value}
        size="lg"
        trailing={
          trend ? (
            <span className="font-mono text-[11px]" style={{ color: trendColor }}>
              {arrow} {trend.pct}
            </span>
          ) : null
        }
        sub={trend ? "vs. Vormonat" : undefined}
      />
      {spark && spark.length > 1 && (
        <Sparkline values={spark} color={trendColor} className="w-full h-5 mt-2" />
      )}
    </div>
  );
}
