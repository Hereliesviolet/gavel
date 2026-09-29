import { cn } from "@/lib/utils";

type ScoreValue = "attraktiv" | "neutral" | "abraten";
type ScoreVariant = "investment" | "flip" | "strategy";

const VARIANT_CLASS: Record<ScoreVariant, Record<ScoreValue, string>> = {
  investment: {
    attraktiv: "bg-[var(--success-container)] text-[var(--success-container-fg)]",
    neutral: "bg-muted text-muted-foreground",
    abraten: "bg-[var(--error-container)] text-[var(--error-container-fg)]",
  },
  flip: {
    attraktiv: "bg-[var(--success-container)] text-[var(--success-container-fg)]",
    neutral: "bg-muted text-muted-foreground",
    abraten: "bg-[var(--error-container)] text-[var(--error-container-fg)]",
  },
  strategy: {
    attraktiv: "bg-primary/10 text-primary",
    neutral: "bg-muted text-foreground",
    abraten: "bg-[var(--error-container)] text-[var(--error-container-fg)]",
  },
};

const VALUE_LABEL: Record<ScoreValue, string> = {
  attraktiv: "Attraktiv",
  neutral: "Neutral",
  abraten: "Abraten",
};

/** Verbindliche Präfixe laut docs/METRICS_GLOSSARY.md — unterscheiden die beiden Scores. */
const VARIANT_PREFIX: Record<ScoreVariant, string | null> = {
  investment: "Kapitalanlage",
  flip: "Fix&Flip",
  strategy: null,
};

export function ScoreBadge({
  score,
  variant = "investment",
  label,
  className,
}: {
  score: ScoreValue | string | null | undefined;
  variant?: ScoreVariant;
  label?: string;
  className?: string;
}) {
  if (!score || !(score in VALUE_LABEL)) return null;
  const value = score as ScoreValue;
  const prefix = VARIANT_PREFIX[variant];
  const text = label ?? (prefix ? `${prefix} · ${VALUE_LABEL[value]}` : VALUE_LABEL[value]);

  return (
    <span
      className={cn(
        "font-mono text-[10px] px-1.5 py-px rounded-[4px] uppercase tracking-[0.06em]",
        VARIANT_CLASS[variant][value],
        className,
      )}
      title={
        variant === "investment"
          ? "Kapitalanlage-Score (Buy & Hold, LLM)"
          : variant === "flip"
            ? "Fix&Flip-Chance (berechnet aus Flip-ROI)"
            : undefined
      }
    >
      {text}
    </span>
  );
}
