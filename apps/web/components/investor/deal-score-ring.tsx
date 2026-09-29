"use client";

import type { InvestorPick } from "@/lib/investor-picks";
import { KONFIDENZ_LABEL } from "@/lib/investor-signals";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function DealScoreRing({
  pick,
  size = 56,
  className,
}: {
  pick: InvestorPick;
  size?: number;
  className?: string;
}) {
  const score = pick.chance.wert;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className={cn("relative inline-flex shrink-0 rounded-full", className)}>
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
              stroke="currentColor"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="text-primary transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="font-mono text-sm font-semibold leading-none">{score}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p>
            Chance {score}/100 · Konfidenz {KONFIDENZ_LABEL[pick.chance.konfidenz]}. Summe der
            belegten Signale, gewichtet mit der Datenreife. Keine Gebotsempfehlung.
          </p>
          {pick.chance.begruendung.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4">
              {pick.chance.begruendung.slice(0, 3).map((grund) => (
                <li key={grund}>{grund}</li>
              ))}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
