// Persistent, unobtrusive top-of-page banner shown whenever the active
// dataset is synthetic demo data. Server component — reads DATA_PROVIDER
// directly (mirrors the private isDemoMode() check in
// lib/markets/queries.ts) so it can sit in the root layout above any
// per-page VM fetch, rather than requiring every page to thread a prop
// through. Pass `demoMode` explicitly to override when a page already has
// it from a fetched VM (keeps a single source of truth per request).
export function DemoBanner({ demoMode }: { demoMode?: boolean }) {
  const isDemo = demoMode ?? (process.env.DATA_PROVIDER ?? 'demo') === 'demo';
  if (!isDemo) return null;
  return (
    <div className="border-b border-[var(--border)] bg-[var(--warn-bg)] px-4 py-1.5 text-center text-xs font-medium text-[var(--warn)]">
      Synthetic demo data. Not current airfare.
    </div>
  );
}
