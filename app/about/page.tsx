import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About',
  description: 'What Fare Terminal is, what it is not, and how to read the data it shows.',
};

export default function AboutPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">About</h1>

      <div className="flex flex-col gap-4 text-sm leading-relaxed text-[var(--text-secondary)]">
        <p>
          Fare Terminal is airfare{' '}
          <strong className="text-[var(--text-primary)]">market intelligence</strong>
          {' '}
          — think &quot;stock ticker meets research terminal&quot; for flight prices. For a set of tracked
          airport-pair routes, it turns repeated observed offers into a current benchmark price, price
          history, a fair-value range, detected market events, and a plain-language recommendation, with
          every claim clearly split into what was directly observed versus what was inferred from it.
        </p>
        <p>
          It is <strong className="text-[var(--text-primary)]">not</strong> a booking site, a flight search
          engine, or a price-prediction service. It does not sell tickets, hold inventory, or guarantee any
          price will still be available by the time you check. Recommendations are a statistical read of
          historical patterns for a route, not personalized travel or financial advice, and should never be
          the only input into a booking decision.
        </p>
        <p>
          Data quality varies by source and is always disclosed: this deployment may be running on entirely
          synthetic demo data (shown with a persistent banner when active), or on real but cached/aggregated
          third-party observations with their own limitations. See the{' '}
          <Link href="/methodology" className="text-[var(--accent)] hover:underline">
            methodology
          </Link>{' '}
          page for exactly how every number is computed and where each data source falls short — and always
          verify the actual price on an airline or travel site before booking.
        </p>
      </div>
    </div>
  );
}
