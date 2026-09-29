import { formatTerminRelativ, type InvestorPick } from "@/lib/investor-picks";
import { formatCurrency, formatDate } from "@/lib/utils";
import { UrgencyBadge, daysUntil } from "@/components/ui/urgency-badge";
import { cn } from "@/lib/utils";

export function shortRiskLabel(risk: string): string {
  const colon = risk.indexOf(":");
  if (colon > 0 && colon <= 28) return risk.slice(0, colon).trim();
  if (risk.length <= 32) return risk;
  return `${risk.slice(0, 29)}…`;
}

export function MetricRow({
  pick,
  className,
  compact = false,
  variant,
}: {
  pick: InvestorPick;
  className?: string;
  compact?: boolean;
  variant?: "fix_flip" | "buy_hold" | "unter_markt" | "zeitnah";
}) {
  const tage = daysUntil(pick.listing.terminDate);
  const parts: string[] = [];
  const strategy = variant ?? pick.strategy;

  const vw = formatCurrency(pick.metrics.verkehrswert);
  if (vw) parts.push(`VW ${vw}`);
  if (
    strategy !== "zeitnah" &&
    pick.metrics.referenceBidEur != null &&
    pick.metrics.referenceBidPct != null
  ) {
    parts.push(
      `Referenzgebot ${pick.metrics.referenceBidPct.toFixed(0)} %: ${formatCurrency(pick.metrics.referenceBidEur)}`,
    );
  }
  if (!compact && strategy !== "zeitnah" && pick.metrics.maxBidEur != null) {
    parts.push(`vorl. Profil-Max. ${formatCurrency(pick.metrics.maxBidEur)}`);
  }

  if (strategy === "fix_flip" && pick.metrics.baseFlipMarginPct != null) {
    parts.push(`${pick.metrics.baseFlipMarginPct.toFixed(0)} % Flip-Marge`);
  } else if (strategy === "buy_hold") {
    if (pick.metrics.baseCashOnCashPct != null) {
      parts.push(`${pick.metrics.baseCashOnCashPct.toFixed(1)}% Cash-on-Cash`);
    }
    if (pick.metrics.baseDscr != null) {
      parts.push(`${pick.metrics.baseDscr.toFixed(2)} DSCR`);
    }
  } else if (strategy === "unter_markt") {
    if (pick.metrics.marktlueckePct != null && pick.metrics.marktlueckePct > 0) {
      parts.push(
        `${pick.metrics.marktlueckePct.toFixed(0)} % unter Angebotsniveau` +
          (pick.metrics.marktreferenzStichprobe > 0
            ? ` (n=${pick.metrics.marktreferenzStichprobe})`
            : ""),
      );
    }
  } else if (strategy === "zeitnah" && pick.metrics.terminTage != null) {
    parts.push(`Termin ${formatTerminRelativ(pick.metrics.terminTage)}`);
  } else if (strategy === "all" || strategy === "wildcard") {
    if (pick.metrics.baseFlipMarginPct != null) {
      parts.push(`${pick.metrics.baseFlipMarginPct.toFixed(0)} % Flip-Marge`);
    } else if (pick.metrics.baseCashOnCashPct != null) {
      parts.push(`${pick.metrics.baseCashOnCashPct.toFixed(1)}% Cash-on-Cash`);
      if (pick.metrics.baseDscr != null) {
        parts.push(`${pick.metrics.baseDscr.toFixed(2)} DSCR`);
      }
    }
  }

  if (pick.metrics.preisProM2 != null) {
    parts.push(`${Math.round(pick.metrics.preisProM2).toLocaleString("de-DE")} €/m²`);
  }

  if (pick.listing.terminDate) {
    parts.push(formatDate(pick.listing.terminDate) ?? "—");
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
        {parts.join(" · ")}
      </p>
      {tage != null && <UrgencyBadge days={tage} />}
    </div>
  );
}

export function MetricChips({ pick, className }: { pick: InvestorPick; className?: string }) {
  return <MetricRow pick={pick} className={className} />;
}

export function RisikoChips({
  risiken,
  max = 2,
  className,
  variant = "inline",
}: {
  risiken: string[];
  max?: number;
  className?: string;
  variant?: "inline" | "stack";
}) {
  if (risiken.length === 0) return null;

  if (variant === "stack") {
    return (
      <ul className={cn("space-y-1", className)}>
        {risiken.slice(0, max).map((risk) => (
          <li key={risk} className="text-xs text-muted-foreground leading-snug">
            {shortRiskLabel(risk)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p className={cn("text-xs text-muted-foreground leading-snug", className)}>
      {risiken.slice(0, max).map(shortRiskLabel).join(" · ")}
    </p>
  );
}

export function TopRiskHint({ risiken, className }: { risiken: string[]; className?: string }) {
  if (risiken.length === 0) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      <span className="text-warning">⚠</span> {shortRiskLabel(risiken[0])}
    </p>
  );
}
