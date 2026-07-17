function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/5 ${className ?? ''}`} />;
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <SkeletonBlock className="h-4 w-24" />
      <SkeletonBlock className="h-7 w-32" />
      <SkeletonBlock className="h-3 w-40" />
      <SkeletonBlock className="h-3 w-full" />
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading market pulse">
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-8 w-56" />
        <SkeletonBlock className="h-4 w-full max-w-2xl" />
        <SkeletonBlock className="h-16 w-full" />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="mt-3 h-4 w-full" />
        <SkeletonBlock className="mt-2 h-4 w-2/3" />
      </div>

      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-3">
          <SkeletonBlock className="h-4 w-36" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      ))}
    </div>
  );
}
