import { cn } from "@/lib/utils";

export function CodeBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-[4px] border border-border bg-card p-6 font-mono text-sm text-foreground",
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  );
}
