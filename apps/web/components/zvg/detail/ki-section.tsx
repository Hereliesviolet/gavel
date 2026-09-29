"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { SeverityTag, type SeverityLevel } from "@/components/ui/severity";

export interface KiSectionProps {
  num: string;
  title: string;
  /** Kurze Schlagzeile rechts neben dem Titel (vor Chevron). */
  summary?: React.ReactNode;
  severity?: SeverityLevel;
  /** Severity-Label override; default ist OK/INFO/MITTEL/SCHWER. */
  severityLabel?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Einheitliche Shell für alle KI-Sektionen auf der Detail-Seite.
 * Das ganze Accordion-Verhalten wird hier gehandled.
 *
 * <KiSection num="01" title="Grundbuch" severity="ok" summary="lastenfrei">
 *   ...body...
 * </KiSection>
 */
export function KiSection({
  num,
  title,
  summary,
  severity = "info",
  severityLabel,
  defaultOpen = false,
  children,
  className,
}: KiSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("border-b border-border/50 last:border-b-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-3 w-full px-4 py-2.5 bg-[var(--surface-toolbar)] hover:bg-muted/40 text-left transition-colors"
      >
        <span className="font-mono text-[11px] text-muted-foreground w-7">{num}</span>
        <SeverityTag level={severity}>
          {severityLabel ?? { ok: "OK", info: "INFO", warn: "MITTEL", err: "SCHWER" }[severity]}
        </SeverityTag>
        <span className="text-sm font-semibold flex-1">{title}</span>
        {summary && (
          <span className="font-mono text-[11px] text-muted-foreground hidden md:inline">
            {summary}
          </span>
        )}
        {open ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open && <div className="px-4 sm:px-14 py-4 bg-card">{children}</div>}
    </div>
  );
}

/**
 * Wrapper: alle KI-Sektionen in einer Karte mit einheitlicher Linie.
 */
export function KiSectionGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border border-border rounded-[4px] overflow-hidden", className)}>
      {children}
    </div>
  );
}

/**
 * Einzelnes Finding innerhalb einer KI-Sektion.
 * Wird in Mängel, Belastungen, Grundbuch verwendet.
 */
export function KiFinding({
  tag,
  text,
  amount,
  severity = "info",
}: {
  tag: string;
  text: React.ReactNode;
  amount?: React.ReactNode;
  severity?: SeverityLevel;
}) {
  const color = {
    ok: "var(--success)",
    info: "var(--info)",
    warn: "var(--warning)",
    err: "var(--destructive)",
  }[severity];
  return (
    <div
      className="flex gap-3 px-3 py-2 border border-border border-l-[3px] rounded-[4px] bg-[var(--surface-toolbar)] items-center"
      style={{ borderLeftColor: color }}
    >
      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] min-w-[100px] shrink-0">
        {tag}
      </span>
      <span className="text-sm flex-1">{text}</span>
      {amount && <span className="font-mono text-[11px] text-muted-foreground">{amount}</span>}
    </div>
  );
}
