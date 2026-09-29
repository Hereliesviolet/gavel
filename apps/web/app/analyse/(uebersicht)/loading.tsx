export default function AnalyseLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-4 animate-pulse">
      <div className="h-3 w-32 rounded bg-graphite" />
      <div className="h-8 w-64 rounded bg-graphite" />
      <div className="h-40 rounded border border-border bg-graphite/40" />
      <div className="h-56 rounded border border-border bg-graphite/40" />
    </div>
  );
}
