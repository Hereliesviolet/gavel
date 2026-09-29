import type { InvestorQualityResult } from "@/lib/investor-quality";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<InvestorQualityResult["status"], string> = {
  ready: "Finanzdaten vollständig",
  insufficient_data: "Research-Lücken",
  needs_review: "Datenprüfung nötig",
  market_data_missing: "ZVG-Peer-Daten fehlen",
  stale: "Research veraltet",
  not_applicable: "Nicht anwendbar",
};

export function InvestorQualityBadge({
  quality,
  compact = false,
  className,
}: {
  quality: InvestorQualityResult;
  compact?: boolean;
  className?: string;
}) {
  const safe = quality.status === "ready";
  const label = STATUS_LABEL[quality.status];
  const title = [...quality.blockers, ...quality.warnings].join(" ") || label;

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-[4px] border font-mono",
        compact ? "px-1.5 py-px text-[9px]" : "px-2 py-1 text-[10px]",
        safe
          ? "border-[var(--success)]/30 bg-[var(--success-container)] text-[var(--success-container-fg)]"
          : "border-[var(--warning)]/30 bg-[var(--warning-container)] text-[var(--warning-container-fg)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
