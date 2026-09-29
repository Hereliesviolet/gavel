import { DATENREIFE_LABEL, type Datenreife } from "@/lib/investor-signals";
import { cn } from "@/lib/utils";

/**
 * Zeigt die maschinelle Datenreife, nicht den Arbeitsstand des Nutzers.
 *
 * Die frueheren vier Stufen sahen aus wie ein CRM-Status, ohne dass sich etwas
 * verschieben liess — und die hoechste war durch den Readiness-Deckel ohnehin
 * unerreichbar. Der vom Nutzer gesetzte Pipeline-Status kommt getrennt davon
 * im Deal-Desk.
 */
const DATENREIFE_STYLE: Record<Datenreife, string> = {
  unvollstaendig: "border-border bg-muted text-muted-foreground",
  bewertbar: "border-primary/40 bg-primary/10 text-primary",
  verifiziert: "border-success/40 bg-success/10 text-success",
};

const SONDERSITUATION_STYLE = "border-destructive/40 bg-destructive/10 text-destructive";

export function InvestorStageBadge({
  datenreife,
  sondersituation = false,
  compact = false,
  className,
}: {
  datenreife: Datenreife;
  sondersituation?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        sondersituation ? SONDERSITUATION_STYLE : DATENREIFE_STYLE[datenreife],
        className,
      )}
    >
      {sondersituation ? "Sondersituation" : DATENREIFE_LABEL[datenreife]}
    </span>
  );
}
