import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Panel } from '@/components/ui/Panel';
import { CollapsibleSection } from '@/components/market/CollapsibleSection';
import { DateHeatmap } from '@/components/market/DateHeatmap';
import { MarketHeader } from '@/components/market/MarketHeader';
import { RelatedMarkets } from '@/components/market/RelatedMarkets';
import { SectionNavDesktopTabs } from '@/components/market/SectionNav';
import { SummaryCard } from '@/components/market/SummaryCard';
import { GoogleInsightsLine } from '@/components/market/GoogleInsightsLine';
import { RecommendationPanel } from '@/components/market/RecommendationPanel';
import { AnalystNotePanel } from '@/components/market/AnalystNotePanel';
import { WhatChangedPanel } from '@/components/market/WhatChangedPanel';
import { EventTimeline } from '@/components/market/EventTimeline';
import { OfferTable } from '@/components/market/OfferTable';
import { PriceHistoryChart } from '@/components/charts/PriceHistoryChart';
import { formatPriceMinor } from '@/lib/format';
import { buildMarketUrl, parseMarketUrlState, toQueryLookupParams, type RawSearchParams } from '@/lib/url-state';
import { getCalendarHeatmap } from '@/lib/markets/heatmap';
import { getCurrentOffers, getMarketEvents, getMarketHistory, getMarketSummary } from '@/lib/markets/queries';
import { getRelatedMarkets } from '@/lib/markets/related';

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

  const { definition, snapshot, priceReliable } = summary;
  // WP-F1 fix 1: don't publish an unreliable ($0/near-$0) benchmark into SEO
  // metadata / social-share previews — those render outside this app's own
  // "Price data unreliable" UI treatment, so they'd otherwise show a bare
  // "$0" with no context at all.
  const priceClause = priceReliable
    ? `Current benchmark ${formatPriceMinor(snapshot.benchmarkPriceMinor, definition.currency)} for `
    : 'Market analysis for ';
  const canonicalPath = buildMarketUrl(definition.origin, definition.destination, { mode: 'flexible' });
  const title = `${definition.origin}→${definition.destination} flights: market analysis`;
  const description = `${priceClause}${definition.originCity} to ${definition.destinationCity}. ${definition.windowDescription}.`;
  // WP-F5: OG share card generated per-market by
  // app/api/og/market/[origin]/[destination]/route.tsx (next/og
  // ImageResponse) — it independently re-checks priceReliable and renders
  // its own neutral fallback, so this metadata block never needs to branch
  // on priceReliable itself.
  const ogImagePath = `/api/og/market/${definition.origin.toLowerCase()}/${definition.destination.toLowerCase()}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    // Exact-date variants are near-duplicate content keyed by date; only the
    // flexible-benchmark canonical page is indexable (PRD §27).
    robots:
      urlState.mode === 'exact'
        ? { index: false, follow: true }
        : { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      images: [{ url: ogImagePath, width: 1200, height: 630, alt: `${definition.origin} to ${definition.destination} fare chart` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImagePath],
    },
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
  const heatmapMonths = getCalendarHeatmap(summary.definition.origin, summary.definition.destination);
  const relatedMarkets = getRelatedMarkets(summary.definition.origin, summary.definition.destination);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <MarketHeader summary={summary} urlState={urlState} outboundUrl={outboundUrl} />

      {/* WP-F4 §5: sticky in-page section nav — the mobile chip-row
          counterpart lives inside MarketHeader (it has to stack directly
          under that component's own sticky compact bar); this is the
          desktop tab strip, sticky under the full header. */}
      <SectionNavDesktopTabs />

      <div id="section-summary" className="scroll-mt-24 flex flex-col gap-2">
        <SummaryCard summary={summary} />
        <GoogleInsightsLine summary={summary} />
      </div>

      <div id="section-chart" className="scroll-mt-24">
        <Panel title="Price history" titleId="history-title">
          <PriceHistoryChart
            origin={summary.definition.origin}
            destination={summary.definition.destination}
            initialPoints={history}
            events={events}
            currency={summary.definition.currency}
            fairValue={summary.fairValue}
          />
        </Panel>
      </div>

      {/* WP-F4 §2: date-price heatmap, directly below the price chart. */}
      <div id="section-calendar" className="scroll-mt-24">
        <Panel title="Fare calendar" titleId="calendar-title" subtitle="Cheapest departure dates over the next 3 months">
          <DateHeatmap months={heatmapMonths} currency={summary.definition.currency} now={summary.datasetAnchorAt} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecommendationPanel recommendation={summary.recommendation} />
        <AnalystNotePanel note={summary.analystNote} />
      </div>

      <WhatChangedPanel summary={summary} recentEvents={events} />

      {/* max-w-6xl (1152px) caps the container narrower than the `xl`
          breakpoint (1280px), so splitting there squeezed the 9-column
          offer table too tightly at common desktop widths — 2xl (1536px)
          only splits once there's genuinely enough room for both.
          WP-F4 §5: both panels collapse behind a disclosure by default on
          mobile (open on desktop) so the first mobile screen stops at the
          chart instead of scrolling through the full event/offer detail. */}
      <div id="section-events" className="grid scroll-mt-24 grid-cols-1 gap-6 2xl:grid-cols-2">
        <CollapsibleSection title="Event timeline" titleId="timeline-title">
          <EventTimeline events={events} />
        </CollapsibleSection>
        <div id="section-offers" className="scroll-mt-24">
          <CollapsibleSection title="Carriers & itineraries" titleId="offers-title">
            <OfferTable offers={offers} nowMs={summary.datasetAnchorAt} dataSourceMode={summary.dataSourceMode} />
          </CollapsibleSection>
        </div>
      </div>

      {/* WP-F4 §3: related markets, PRD §14.9. */}
      <div id="section-related" className="scroll-mt-24">
        <Panel title="Related markets" titleId="related-title">
          <RelatedMarkets
            origin={summary.definition.origin}
            originCity={summary.definition.originCity}
            markets={relatedMarkets}
            currency={summary.definition.currency}
          />
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
