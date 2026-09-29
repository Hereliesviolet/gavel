import { cn } from "@/lib/utils";

export const PAGE_SHELL_GUTTER =
  "mx-auto w-full max-w-[var(--page-max-width)] px-4 sm:px-6 lg:px-8";

export function PageShell({
  children,
  className,
  compact = false,
}: {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(PAGE_SHELL_GUTTER, compact ? "py-6" : "py-8", className)}>{children}</div>
  );
}
