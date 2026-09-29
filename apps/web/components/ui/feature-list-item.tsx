import { cn } from "@/lib/utils";

export function FeatureListItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("flex items-start gap-2 text-sm text-foreground", className)}>
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
