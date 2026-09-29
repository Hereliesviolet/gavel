"use client";

import type { InvestorPick, PickStrategy } from "@/lib/investor-picks";
import { STRATEGY_THEME } from "@/components/investor/strategy-theme";
import { cn } from "@/lib/utils";

type GaugeStrategy = Exclude<PickStrategy, "wildcard" | "all"> | "einstieg";

function gaugeValue(pick: InvestorPick, strategy: GaugeStrategy): { value: number; label: string } {
  if (strategy === "einstieg") {
    return { value: pick.chance.wert, label: String(pick.chance.wert) };
  }
  if (strategy === "fix_flip" && pick.metrics.baseFlipMarginPct != null) {
    return {
      value: Math.min(100, Math.max(0, pick.metrics.baseFlipMarginPct * 4)),
      label: `${pick.metrics.baseFlipMarginPct.toFixed(0)}% Marge`,
    };
  }
  if (strategy === "buy_hold" && pick.metrics.baseCashOnCashPct != null) {
    return {
      value: Math.max(0, Math.min(100, pick.metrics.baseCashOnCashPct * 10)),
      label: `${pick.metrics.baseCashOnCashPct.toFixed(1)}% CoC`,
    };
  }
  if (strategy === "unter_markt") {
    const gap = pick.metrics.marktlueckePct;
    if (gap != null && Number.isFinite(gap)) {
      return {
        value: Math.min(100, gap * 3),
        label: `−${gap.toFixed(0)}% Angebotsniveau`,
      };
    }
  }
  if (strategy === "zeitnah" && pick.metrics.terminTage != null) {
    const days = pick.metrics.terminTage;
    return { value: Math.max(0, 100 - days * 5), label: `${days} Tage` };
  }
  return { value: pick.chance.wert, label: String(pick.chance.wert) };
}

export function InvestorMetricGauge({
  pick,
  strategy,
  size = 56,
  className,
}: {
  pick: InvestorPick;
  strategy: GaugeStrategy;
  size?: number;
  className?: string;
}) {
  const themeKey = strategy === "einstieg" ? "einstieg" : strategy;
  const theme = STRATEGY_THEME[themeKey as keyof typeof STRATEGY_THEME];
  const color = theme.color;
  const { value, label } = gaugeValue(pick, strategy);
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (value / 100) * circumference;

  return (
    <div className={cn("relative inline-flex shrink-0", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-500"
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-1"
        title={strategy === "einstieg" ? "Chance (0–100)" : undefined}
      >
        <span
          className={cn(
            "font-mono font-semibold leading-none text-center",
            strategy === "einstieg" ? "text-sm" : "text-[10px] sm:text-xs",
          )}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
