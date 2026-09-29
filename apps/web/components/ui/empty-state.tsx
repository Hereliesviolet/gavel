import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  message,
  action,
  className,
}: {
  message: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[4px] border border-border bg-card px-4 py-4", className)}>
      <p className="font-mono text-sm text-muted-foreground">{message}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
