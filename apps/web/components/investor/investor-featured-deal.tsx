"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Calculator, Home } from "lucide-react";
import type { InvestorPick, PickStrategy } from "@/lib/investor-picks";
import { getFeaturedDealLabel } from "@/lib/investor-picks";
import { DealPlaybookSteps } from "@/components/investor/deal-playbook-steps";
import { DealScoreRing } from "@/components/investor/deal-score-ring";
import { InvestorMetricGauge } from "@/components/investor/investor-metric-gauge";
import { MetricRow, TopRiskHint } from "@/components/investor/metric-chips";
import { STRATEGY_THEME } from "@/components/investor/strategy-theme";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { Button } from "@/components/ui/button";
import { findBundesland } from "@/lib/bundesland";
import { listingImageSrc } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";
import { InvestorQualityBadge } from "@/components/investor/investor-quality-badge";
import { InvestorStageBadge } from "@/components/investor/investor-stage-badge";

export function InvestorFeaturedDeal({
  pick,
  strategy = "all",
  initialFavorited = false,
}: {
  pick: InvestorPick;
  strategy?: PickStrategy;
  initialFavorited?: boolean;
}) {
  const [tab, setTab] = useState<"overview" | "playbook">("overview");
  const theme = STRATEGY_THEME[pick.strategy === "wildcard" ? "all" : pick.strategy];
  const detailHref = zvgListingPath(pick.bundesland, pick.slug) ?? "/";
  const coverSrc = listingImageSrc(pick.listing.coverImageUrl);
  const landSlug = findBundesland(pick.bundesland)?.slug ?? pick.bundesland;
  const rechnerHref = pick.metrics.verkehrswert
    ? `/rechner?verkehrswert=${pick.metrics.verkehrswert}&versteigerungswert=${pick.metrics.referenceBidEur ?? pick.metrics.verkehrswert}&bundesland=${encodeURIComponent(landSlug)}`
    : "/rechner";

  return (
    <section className="rounded-[4px] border border-border/60 bg-card/80 mb-10 overflow-hidden">
      <div className="relative aspect-[2/1] sm:aspect-[21/9] max-h-[320px] bg-muted">
        {coverSrc ? (
          <Image
            src={coverSrc}
            alt={pick.listing.typ ?? "Featured Deal"}
            fill
            className="object-cover"
            sizes="(max-width: 1280px) 100vw, 1280px"
            priority
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Home className="size-12 text-muted-foreground/20" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-28 bg-graphite-deep/85" />
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-background/90 text-foreground border border-border">
            {theme.label}
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary text-primary-foreground">
            {getFeaturedDealLabel(strategy)}
          </span>
        </div>
        <div className="absolute bottom-4 left-5 right-5">
          <p className="text-lg font-semibold text-foreground">
            {pick.listing.ort ?? pick.listing.bundeslandName}
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <InvestorStageBadge
              datenreife={pick.chance.datenreife}
              sondersituation={pick.chance.sondersituation}
            />
            <InvestorQualityBadge quality={pick.quality} />
          </div>
          <p className="text-base sm:text-lg font-medium text-foreground leading-snug">
            {pick.hook}
          </p>
          <TopRiskHint risiken={pick.risiken} />
          {pick.heroCaution && (
            <p className="text-xs text-warning">
              Research-Kandidat, noch keine Gebotsfreigabe. Referenz- und Maximalgebot sind
              vorläufig.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {strategy !== "all" && strategy !== "wildcard" ? (
            <InvestorMetricGauge pick={pick} strategy={strategy} />
          ) : (
            <DealScoreRing pick={pick} />
          )}
          <MetricRow
            pick={pick}
            variant={strategy !== "all" && strategy !== "wildcard" ? strategy : undefined}
            className="flex-1 min-w-0"
          />
        </div>

        <div className="flex gap-4 border-b border-border">
          {(["overview", "playbook"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "pb-2 text-sm transition-colors border-b-2 -mb-px",
                tab === t
                  ? "border-foreground text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "overview" ? "Überblick" : "Playbook"}
            </button>
          ))}
        </div>

        <div className="min-h-[72px]">
          {tab === "overview" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                {pick.pitch}
              </p>
              {pick.nextChecks.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Vor Gebotsreife:</span>{" "}
                  {pick.nextChecks.slice(0, 3).join(" · ")}
                </p>
              )}
            </div>
          ) : (
            <DealPlaybookSteps pick={pick} compact />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button asChild size="sm">
            <Link href={detailHref}>
              Zur Detailanalyse
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={rechnerHref}>
              <Calculator className="size-4" />
              Rechner
            </Link>
          </Button>
          <FavoriteButton
            listingId={pick.listingId}
            initialFavorited={initialFavorited}
            className="ml-auto"
          />
        </div>
      </div>
    </section>
  );
}
