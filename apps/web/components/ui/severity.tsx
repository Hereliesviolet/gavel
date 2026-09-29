import { cn } from "@/lib/utils";

export type SeverityLevel = "ok" | "info" | "warn" | "err";

const STYLES: Record<SeverityLevel, { bg: string; fg: string; label: string }> = {
  ok: {
    bg: "bg-[var(--success-container)]",
    fg: "text-[var(--success-container-fg)]",
    label: "OK",
  },
  info: { bg: "bg-[var(--info-container)]", fg: "text-[var(--info-container-fg)]", label: "INFO" },
  warn: {
    bg: "bg-[var(--warning-container)]",
    fg: "text-[var(--warning-container-fg)]",
    label: "MITTEL",
  },
  err: {
    bg: "bg-[var(--error-container)]",
    fg: "text-[var(--error-container-fg)]",
    label: "SCHWER",
  },
};

const DOT_COLOR: Record<SeverityLevel, string> = {
  ok: "var(--success)",
  info: "var(--info)",
  warn: "var(--warning)",
  err: "var(--destructive)",
};

export function SeverityTag({
  level,
  children,
  className,
}: {
  level: SeverityLevel;
  children?: React.ReactNode;
  className?: string;
}) {
  const s = STYLES[level];
  return (
    <span
      className={cn(
        "font-mono text-[10px] px-1.5 py-px rounded-[4px] uppercase tracking-[0.08em]",
        s.bg,
        s.fg,
        className,
      )}
    >
      {children ?? s.label}
    </span>
  );
}

export function SeverityDot({ level, className }: { level: SeverityLevel; className?: string }) {
  return (
    <span
      className={cn("inline-block size-1.5 rounded-full", className)}
      style={{ background: DOT_COLOR[level] }}
    />
  );
}

export function severityColor(level: SeverityLevel): string {
  return DOT_COLOR[level];
}
