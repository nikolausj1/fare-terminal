// WP-F3: skeleton reshaped to match the new home page layout (Index hero,
// Top movers, Deals ticker, Newly favorable, Unusual events, AI brief).
// Uses the `.skeleton` shimmer class (app/globals.css) instead of Tailwind's
// flat `animate-pulse`, per the WP-F3 motion inventory — respects
// prefers-reduced-motion via the same blanket rule every other animation on
// this page does (globals.css collapses animation-duration to ~0).

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? ''}`} />;
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <SkeletonBlock className="h-4 w-24" />
      <div className="flex items-center justify-between gap-3">
        <SkeletonBlock className="h-7 w-28" />
        <SkeletonBlock className="h-9 w-[120px]" />
      </div>
      <SkeletonBlock className="h-3 w-40" />
      <SkeletonBlock className="h-3 w-full" />
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8" aria-busy="true" aria-label="Loading market pulse">
      {/* Hero title + collapsed search row */}
      <div className="flex flex-col gap-2 sm:gap-3">
        <SkeletonBlock className="h-6 w-44 sm:h-8 sm:w-56" />
        <SkeletonBlock className="h-4 w-full max-w-2xl" />
        <SkeletonBlock className="h-11 w-full rounded-lg" />
      </div>

      {/* Index hero */}
      <div className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
        <SkeletonBlock className="h-4 w-40" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <SkeletonBlock className="h-10 w-32" />
            <SkeletonBlock className="h-4 w-40" />
          </div>
          <SkeletonBlock className="h-16 w-full sm:h-20 sm:w-64" />
        </div>
      </div>

      {/* Top movers */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-4 w-36" />
          <SkeletonBlock className="h-3 w-24" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>

      {/* Deals ticker */}
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-4 w-64" />
        <div className="flex gap-3 overflow-hidden">
          <SkeletonBlock className="h-8 w-40 shrink-0 rounded-full" />
          <SkeletonBlock className="h-8 w-40 shrink-0 rounded-full" />
          <SkeletonBlock className="h-8 w-40 shrink-0 rounded-full" />
          <SkeletonBlock className="h-8 w-40 shrink-0 rounded-full" />
        </div>
      </div>

      {/* Newly favorable */}
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-4 w-36" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>

      {/* Unusual events */}
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="h-10 w-full rounded-md" />
        <SkeletonBlock className="h-10 w-full rounded-md" />
      </div>

      {/* AI brief */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="mt-3 h-4 w-full" />
        <SkeletonBlock className="mt-2 h-4 w-2/3" />
      </div>
    </div>
  );
}
