import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  label,
  action,
  className,
  divider = false,
}: {
  label: ReactNode;
  action?: ReactNode;
  divider?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 mb-3",
        divider && "pb-2 border-b border-border/50",
        className,
      )}
    >
      <span className="label-mono">{label}</span>
      {action ? <div className="text-xs text-accent">{action}</div> : null}
    </div>
  );
}
