export default function ListingLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-4 animate-pulse">
      <div className="h-3 w-40 rounded bg-graphite" />
      <div className="h-10 w-2/3 rounded bg-graphite" />
      <div className="h-64 rounded border border-border bg-graphite/40" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-40 rounded border border-border bg-graphite/40" />
        <div className="h-40 rounded border border-border bg-graphite/40" />
      </div>
    </div>
  );
}
