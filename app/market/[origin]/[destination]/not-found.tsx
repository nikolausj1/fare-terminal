import { SearchBox } from '@/components/search/SearchBox';

export default function MarketNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16 sm:px-6">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Market not tracked</h1>
      <p className="text-sm text-[var(--text-secondary)]">
        We don&apos;t have data for that route yet. Try one of the tracked markets below.
      </p>
      <SearchBox />
    </div>
  );
}
