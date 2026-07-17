'use client';

import { useMemo, useState } from 'react';

import { formatAbsoluteTime, formatDurationMinutes, formatPriceMinor, formatRelativeTime } from '@/lib/format';
import type { OfferRowVM } from '@/lib/markets/view-models';

type SortKey = 'price' | 'duration' | 'stops';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'stops', label: 'Stops' },
  { key: 'duration', label: 'Duration' },
];

function sortValue(offer: OfferRowVM, key: SortKey): number {
  if (key === 'price') return offer.priceMinor;
  if (key === 'duration') return offer.durationMinutes;
  return offer.stops;
}

function formatDepartArrive(offer: OfferRowVM): string {
  if (!offer.departIso || !offer.arriveIso) return 'Not provided';
  const depart = new Date(offer.departIso);
  const arrive = new Date(offer.arriveIso);
  const fmt = (d: Date) =>
    Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${fmt(depart)} – ${fmt(arrive)}`;
}

/** Current offers table. Sort state + mobile card-list fallback are the
 * only client-side concerns; the row data is fetched server-side.
 *
 * Note: OfferRowVM does not expose marketingCarriers/operatingCarriers
 * counts, only the single validating carrier — so the "codeshare" note
 * called for by the WP5 brief (marketingCarriers > operatingCarriers) can't
 * be rendered from this VM as-is; flagged in the WP5 report as a query-layer
 * gap rather than silently guessed at here. */
// nowMs is the dataset anchor (not Date.now()): server render and client
// hydration must agree on "Xm ago" strings, and every other freshness
// display in the app is anchored to the dataset, not the wall clock.
export function OfferTable({ offers, nowMs }: { offers: OfferRowVM[]; nowMs: number }) {
  const [sortKey, setSortKey] = useState<SortKey>('price');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const copy = [...offers];
    copy.sort((a, b) => (sortValue(a, sortKey) - sortValue(b, sortKey)) * (sortDir === 'asc' ? 1 : -1));
    return copy;
  }, [offers, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  if (offers.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
        No current offers available.
      </p>
    );
  }

  return (
    <>
      {/* Desktop / wide layout: real table. data-testid: the price-history
          "View as table" table also renders a <table> on this page, and the
          mobile card list below duplicates the same offer fields, so
          neither role nor text content alone disambiguates which layout is
          active — tests/e2e/market.spec.ts and mobile.spec.ts target these
          two wrappers directly. */}
      <div data-testid="offer-table-desktop" className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              <th scope="col" className="py-2 pr-3">
                Airline
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="py-2 pr-3"
                  aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                  >
                    {col.label}
                    {sortKey === col.key && <span aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
              <th scope="col" className="py-2 pr-3">
                Depart–Arrive
              </th>
              <th scope="col" className="py-2 pr-3">
                Fare brand
              </th>
              <th scope="col" className="py-2 pr-3">
                Seats left
              </th>
              <th scope="col" className="py-2 pr-3">
                Observed
              </th>
              <th scope="col" className="py-2">
                <span className="sr-only">Link</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((offer, i) => (
              <tr key={i} className="border-b border-[var(--border)]/60 last:border-0">
                <td className="num py-2 pr-3 font-medium text-[var(--text-primary)]">
                  {offer.carrierName} <span className="text-[var(--text-tertiary)]">({offer.carrierCode})</span>
                </td>
                <td className="num py-2 pr-3 font-semibold">{formatPriceMinor(offer.priceMinor, offer.currency)}</td>
                <td className="num py-2 pr-3">{offer.stops === 0 ? 'Nonstop' : offer.stops}</td>
                <td className="num py-2 pr-3">{formatDurationMinutes(offer.durationMinutes)}</td>
                <td className="num py-2 pr-3">{formatDepartArrive(offer)}</td>
                <td className="py-2 pr-3">{offer.fareBrand ?? 'Not provided'}</td>
                <td className="num py-2 pr-3">{offer.seatsRemaining ?? 'Not provided'}</td>
                <td className="num py-2 pr-3 text-[var(--text-tertiary)]" title={formatAbsoluteTime(offer.lastObservedAt)}>
                  {formatRelativeTime(offer.lastObservedAt, nowMs)}
                </td>
                <td className="py-2">
                  {offer.outboundUrl ? (
                    <a
                      href={offer.outboundUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-[var(--accent)] hover:underline"
                      aria-label={`Check current availability for ${offer.carrierName} on an external site`}
                    >
                      ↗
                    </a>
                  ) : (
                    <span className="text-[var(--text-tertiary)]" aria-label="Not available in demo">
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile layout: card list */}
      <ul data-testid="offer-table-mobile" className="flex flex-col gap-2 md:hidden">
        {sorted.map((offer, i) => (
          <li key={i} className="rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {offer.carrierName} <span className="text-[var(--text-tertiary)]">({offer.carrierCode})</span>
              </span>
              <span className="num text-lg font-semibold text-[var(--text-primary)]">
                {formatPriceMinor(offer.priceMinor, offer.currency)}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
              <div className="flex justify-between">
                <dt>Stops</dt>
                <dd className="num">{offer.stops === 0 ? 'Nonstop' : offer.stops}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Duration</dt>
                <dd className="num">{formatDurationMinutes(offer.durationMinutes)}</dd>
              </div>
              <div className="col-span-2 flex justify-between">
                <dt>Depart–Arrive</dt>
                <dd className="num">{formatDepartArrive(offer)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Fare brand</dt>
                <dd>{offer.fareBrand ?? 'Not provided'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Seats left</dt>
                <dd className="num">{offer.seatsRemaining ?? 'Not provided'}</dd>
              </div>
            </dl>
            <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
              <span title={formatAbsoluteTime(offer.lastObservedAt)}>Observed {formatRelativeTime(offer.lastObservedAt, nowMs)}</span>
              {offer.outboundUrl ? (
                <a href={offer.outboundUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--accent)] hover:underline">
                  Check availability ↗
                </a>
              ) : (
                <span>Not available in demo</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
