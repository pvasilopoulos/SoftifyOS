export default function AppLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Φόρτωση">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200/80" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-slate-200/60" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="soft-panel h-24 animate-pulse bg-white/70"
            style={{ animationDelay: `${i * 50}ms` }}
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="soft-panel h-64 animate-pulse" />
        <div className="soft-panel h-64 animate-pulse" />
      </div>
    </div>
  );
}
