"use client";

import Link from "next/link";
import { Calculator, FileText, Wrench, type LucideIcon } from "lucide-react";
import type { FixFlipMassnahme } from "@/components/zvg/detail/ki-sections/investment-fixflip";
import type { InvestorPick } from "@/lib/investor-picks";
import { cn } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";

const PRIORITAET_LABEL: Record<string, string> = {
  hoch: "HOCH",
  mittel: "MITTEL",
  niedrig: "NIEDRIG",
};

function formatCostRange(min?: number | null, max?: number | null): string | null {
  const fmt = (n: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  if (min != null && max != null) return `~ ${fmt(min)}–${fmt(max)}`;
  if (min != null) return `ab ${fmt(min)}`;
  if (max != null) return `bis ${fmt(max)}`;
  return null;
}

function defaultBuyHoldSteps(): { label: string; detail?: string; icon: LucideIcon }[] {
  return [
    { label: "Miete und Vermietbarkeit gegen Markt prüfen", icon: FileText },
    { label: "Hausgeld und Bewirtschaftungskosten verifizieren", icon: FileText },
    { label: "Finanzierung und Cashflow kalkulieren", icon: Calculator },
  ];
}

function defaultUnterMarktSteps(): { label: string; icon: LucideIcon }[] {
  return [
    { label: "Gebot unter Verkehrswert strategisch prüfen", icon: FileText },
    { label: "Gutachten auf Widersprüche und Mängel lesen", icon: FileText },
    { label: "Erwerbskosten und Finanzierung berechnen", icon: Calculator },
  ];
}

function defaultZeitnahSteps(): { label: string; icon: LucideIcon }[] {
  return [
    { label: "Termin im Kalender notieren", icon: FileText },
    { label: "Erwerbskosten und Limits berechnen", icon: Calculator },
    { label: "Gebotsstrategie vor dem Termin festlegen", icon: FileText },
  ];
}

function buildSteps(pick: InvestorPick): {
  label: string;
  detail?: string;
  icon: LucideIcon;
  href?: string;
}[] {
  if (pick.strategy === "fix_flip" && pick.massnahmen.length > 0) {
    return pick.massnahmen.slice(0, 3).map((m) => ({
      label: m.beschreibung,
      detail: [
        formatCostRange(m.kosten_min_eur, m.kosten_max_eur),
        m.prioritaet
          ? `Priorität ${PRIORITAET_LABEL[m.prioritaet] ?? m.prioritaet.toUpperCase()}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: Wrench,
    }));
  }

  if (pick.strategy === "buy_hold") {
    return defaultBuyHoldSteps();
  }
  if (pick.strategy === "unter_markt") {
    return defaultUnterMarktSteps();
  }
  if (pick.strategy === "zeitnah") {
    return defaultZeitnahSteps();
  }

  return pick.umsetzung.slice(0, 3).map((step) => ({
    label: step,
    icon: FileText,
  }));
}

export function DealPlaybookSteps({
  pick,
  className,
  compact = false,
}: {
  pick: InvestorPick;
  className?: string;
  compact?: boolean;
}) {
  const detailHref = zvgListingPath(pick.bundesland, pick.slug) ?? "/";
  const steps = buildSteps(pick);

  return (
    <div className={cn("space-y-0", className)}>
      {steps.map((step, idx) => {
        const StepIcon = step.icon;
        const isLast = idx === steps.length - 1;
        return (
          <div key={`${step.label}-${idx}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background"
                style={{ borderColor: "var(--border)" }}
              >
                <StepIcon className="size-3 text-muted-foreground" />
              </div>
              {!isLast && <div className="w-px flex-1 bg-border my-1 min-h-[12px]" />}
            </div>
            <div className={cn("pb-4 min-w-0", isLast && "pb-0")}>
              <p className={cn("text-sm font-medium text-foreground", compact && "text-xs")}>
                {step.label}
              </p>
              {step.detail && <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>}
            </div>
          </div>
        );
      })}
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/5">
            <FileText className="size-3 text-primary" />
          </div>
        </div>
        <div className="min-w-0">
          <Link href={detailHref} className="text-sm font-medium text-primary hover:underline">
            Gutachten & Detailanalyse prüfen →
          </Link>
        </div>
      </div>
      {!compact && (
        <p className="text-[10px] text-muted-foreground leading-relaxed pt-3 border-t border-border mt-2">
          KI-generierte Einschätzung, keine Anlageberatung.
        </p>
      )}
    </div>
  );
}

export function getPlaybookStepCount(pick: InvestorPick): number {
  if (pick.strategy === "fix_flip" && pick.massnahmen.length > 0) {
    return Math.min(pick.massnahmen.length, 3) + 1;
  }
  return 4;
}
