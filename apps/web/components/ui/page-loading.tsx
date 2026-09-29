import { PageShell } from "@/components/ui/page-shell";

export function PageLoading({ rows = 3 }: { rows?: number }) {
  return (
    <PageShell className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-3 w-28 bg-muted rounded-[4px]" />
        <div className="h-7 w-48 bg-muted rounded-[4px]" />
        <div className="h-4 w-80 max-w-full bg-muted/70 rounded-[4px]" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 rounded-[4px] border border-border bg-muted/40" />
      ))}
    </PageShell>
  );
}
