"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Home } from "lucide-react";
import type { InvestorPick } from "@/lib/investor-picks";
import { formatListingTitle } from "@/lib/investor-picks";
import { DealPlaybookSteps, getPlaybookStepCount } from "@/components/investor/deal-playbook-steps";
import { MetricRow, RisikoChips } from "@/components/investor/metric-chips";
import { STRATEGY_THEME } from "@/components/investor/strategy-theme";
import { listingImageSrc } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";
import { InvestorQualityBadge } from "@/components/investor/investor-quality-badge";
import { InvestorStageBadge } from "@/components/investor/investor-stage-badge";

export function InvestorDealCard({
  pick,
  variant = "feed",
  className,
}: {
  pick: InvestorPick;
  variant?: "feed" | "compact";
  className?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const theme = STRATEGY_THEME[pick.strategy === "wildcard" ? "all" : pick.strategy];
  const href = zvgListingPath(pick.bundesland, pick.slug) ?? "/";
  const coverSrc = listingImageSrc(pick.listing.coverImageUrl);
  const stepCount = getPlaybookStepCount(pick);

  if (variant === "compact") {
    return (
      <Link
        href={href}
        className={cn(
          "block rounded-[4px] border border-border p-3 hover:bg-muted/30 transition-colors",
          className,
        )}
      >
        <p className="text-sm font-medium line-clamp-2 leading-snug">{pick.hook}</p>
        <InvestorStageBadge
          datenreife={pick.chance.datenreife}
          sondersituation={pick.chance.sondersituation}
          compact
          className="mt-1.5"
        />
        <MetricRow pick={pick} compact className="mt-1.5" />
      </Link>
    );
  }

  return (
    <article
      className={cn(
        "rounded-[4px] border border-border bg-card transition-colors hover:bg-muted/30",
        className,
      )}
    >
      <div className="flex flex-col sm:flex-row">
        <Link
          href={href}
          className="relative block w-full sm:w-40 md:w-44 shrink-0 aspect-[4/3] bg-muted"
        >
          {coverSrc ? (
            <Image
              src={coverSrc}
              alt={pick.listing.typ ?? "Deal"}
              fill
              className="object-cover"
              sizes="224px"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Home className="size-8 text-muted-foreground/20" />
            </div>
          )}
        </Link>

        <div className="flex-1 p-3 min-w-0 flex flex-col gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{theme.label}</span>
              <InvestorStageBadge
                datenreife={pick.chance.datenreife}
                sondersituation={pick.chance.sondersituation}
                compact
              />
              <InvestorQualityBadge quality={pick.quality} compact />
            </div>
            <Link href={href} className="block group">
              <h3 className="text-base font-medium text-foreground group-hover:underline underline-offset-2">
                {formatListingTitle(pick)}
              </h3>
              <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{pick.hook}</p>
            </Link>
          </div>

          <MetricRow pick={pick} compact />

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground self-start transition-colors"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
            {expanded ? "Weniger" : `${stepCount} Schritte`}
          </button>

          {expanded && (
            <div className="pt-3 border-t border-border space-y-3">
              <RisikoChips risiken={pick.risiken} max={3} variant="stack" />
              <p className="text-sm text-muted-foreground line-clamp-3">{pick.pitch}</p>
              <DealPlaybookSteps pick={pick} compact />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
