function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/5 ${className ?? ''}`} />;
}

function SkeletonPanel({ className }: { className?: string }) {
  return (
    <div className={`rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 ${className ?? ''}`}>
      <SkeletonBlock className="h-4 w-32" />
      <SkeletonBlock className="mt-3 h-4 w-full" />
      <SkeletonBlock className="mt-2 h-4 w-2/3" />
    </div>
  );
}

export default function MarketLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8" aria-busy="true" aria-label="Loading market">
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-9 w-48" />
        <SkeletonBlock className="h-4 w-64" />
        <SkeletonBlock className="h-8 w-56" />
      </div>
      <SkeletonPanel />
      <SkeletonPanel className="h-80" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SkeletonPanel />
        <SkeletonPanel />
      </div>
      <SkeletonPanel />
    </div>
  );
}
