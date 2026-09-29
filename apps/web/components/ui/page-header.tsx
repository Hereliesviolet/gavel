import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6", className)}>
      {eyebrow ? <p className="label-mono mb-1">{eyebrow}</p> : null}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {action}
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{description}</p>
      ) : null}
    </header>
  );
}
