import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Panel } from '@/components/ui/Panel';
import { MarketHeader } from '@/components/market/MarketHeader';
import { SummaryCard } from '@/components/market/SummaryCard';
import { RecommendationPanel } from '@/components/market/RecommendationPanel';
import { AnalystNotePanel } from '@/components/market/AnalystNotePanel';
import { WhatChangedPanel } from '@/components/market/WhatChangedPanel';
import { EventTimeline } from '@/components/market/EventTimeline';
import { OfferTable } from '@/components/market/OfferTable';
import { PriceHistoryChart } from '@/components/charts/PriceHistoryChart';
import { formatPriceMinor } from '@/lib/format';
import { buildMarketUrl, parseMarketUrlState, toQueryLookupParams, type RawSearchParams } from '@/lib/url-state';
import { getCurrentOffers, getMarketEvents, getMarketHistory, getMarketSummary } from '@/lib/markets/queries';

interface MarketPageProps {
  params: Promise<{ origin: string; destination: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: MarketPageProps): Promise<Metadata> {
  const { origin, destination } = await params;
  const sp = await searchParams;
  const urlState = parseMarketUrlState(sp);
  const summary = getMarketSummary(origin, destination, toQueryLookupParams(urlState));

  if (!summary) {
    return { title: 'Market not found', robots: { index: false, follow: false } };
  }

  const { definition, snapshot } = summary;
  const priceStr = formatPriceMinor(snapshot.benchmarkPriceMinor, definition.currency);
  const canonicalPath = buildMarketUrl(definition.origin, definition.destination, { mode: 'flexible' });

  return {
    title: `${definition.origin}→${definition.destination} flights: market analysis`,
    description: `Current benchmark ${priceStr} for ${definition.originCity} to ${definition.destinationCity}. ${definition.windowDescription}.`,
    alternates: { canonical: canonicalPath },
    // Exact-date variants are near-duplicate content keyed by date; only the
    // flexible-benchmark canonical page is indexable (PRD §27).
    robots:
      urlState.mode === 'exact'
        ? { index: false, follow: true }
        : { index: true, follow: true },
  };
}

export default async function MarketPage({ params, searchParams }: MarketPageProps) {
  const { origin, destination } = await params;
  const sp = await searchParams;
  const urlState = parseMarketUrlState(sp);
  const summary = getMarketSummary(origin, destination, toQueryLookupParams(urlState));

  if (!summary) {
    notFound();
  }

  const slug = summary.definition.slug;
  const history = getMarketHistory(slug, '30d');
  const events = getMarketEvents(slug, { limit: 100 });
  const offers = getCurrentOffers(slug);
  const outboundUrl = offers.find((o) => o.outboundUrl)?.outboundUrl ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <MarketHeader summary={summary} urlState={urlState} outboundUrl={outboundUrl} />

      <SummaryCard summary={summary} />

      <Panel title="Price history" titleId="history-title">
        <PriceHistoryChart
          origin={summary.definition.origin}
          destination={summary.definition.destination}
          initialPoints={history}
          events={events}
          currency={summary.definition.currency}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecommendationPanel recommendation={summary.recommendation} />
        <AnalystNotePanel note={summary.analystNote} />
      </div>

      <WhatChangedPanel summary={summary} recentEvents={events} />

      {/* max-w-6xl (1152px) caps the container narrower than the `xl`
          breakpoint (1280px), so splitting there squeezed the 9-column
          offer table too tightly at common desktop widths — 2xl (1536px)
          only splits once there's genuinely enough room for both. */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <Panel title="Event timeline" titleId="timeline-title">
          <EventTimeline events={events} />
        </Panel>
        <Panel title="Carriers & itineraries" titleId="offers-title">
          <OfferTable offers={offers} />
        </Panel>
      </div>

      <Panel title="Data quality" titleId="quality-title">
        <p className="text-sm text-[var(--text-secondary)]">
          Data quality score:{' '}
          <span className="num font-semibold text-[var(--text-primary)]">{summary.dataQuality.toFixed(2)}</span> (0–1
          scale, see the{' '}
          <a href="/methodology#data-quality" className="text-[var(--accent)] hover:underline">
            methodology
          </a>
          ).
        </p>
      </Panel>
    </div>
  );
}
