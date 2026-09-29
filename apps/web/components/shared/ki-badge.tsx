import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function KiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent",
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden />
      KI-Analyse
    </span>
  );
}
