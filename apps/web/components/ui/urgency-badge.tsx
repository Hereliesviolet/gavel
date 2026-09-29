import { calendarDaysUntil, cn, isUpcomingTermin } from "@/lib/utils";

/**
 * Tage bis zum Termin. Negativer Wert = bereits vorbei.
 *
 * Schwellen:
 *   < 0          → muted, "vorbei"
 *   0..1         → destructive container
 *   2..7         → warning container
 *   8..30        → muted mono
 *   > 30         → muted mono
 */
export function UrgencyBadge({
  days,
  className,
  showWord = false,
}: {
  days: number | null | undefined;
  className?: string;
  showWord?: boolean;
}) {
  if (days == null) return null;

  const past = days < 0;
  const critical = days >= 0 && days <= 1;
  const urgent = days >= 2 && days <= 7;

  const text = past
    ? "vorbei"
    : days === 0
      ? "heute"
      : days === 1
        ? "morgen"
        : `in ${days} T${showWord ? "agen" : ""}`;

  const cls = past
    ? "bg-muted text-muted-foreground"
    : critical
      ? "bg-[var(--error-container)] text-[var(--error-container-fg)]"
      : urgent
        ? "bg-[var(--warning-container)] text-[var(--warning-container-fg)]"
        : "text-muted-foreground";

  return (
    <span
      className={cn(
        "font-mono text-[10px] px-1.5 py-px rounded-[4px] tracking-tight uppercase",
        cls,
        className,
      )}
    >
      {text}
    </span>
  );
}

export function daysUntil(date: Date | string | null | undefined, now = new Date()): number | null {
  const days = calendarDaysUntil(date, now);
  if (days == null) return null;
  if (days >= 0 && !isUpcomingTermin(date, now)) return -1;
  return days;
}
