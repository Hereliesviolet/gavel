import { cn } from "@/lib/utils";

export function TagBadge({
  children,
  className,
  dot = true,
}: {
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-accent" aria-hidden />}
      {children}
    </span>
  );
}
