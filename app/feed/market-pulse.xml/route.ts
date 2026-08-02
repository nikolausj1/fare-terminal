// GET /feed/market-pulse.xml — RSS 2.0, read-only, unauthenticated: one
// item per market event of severity MEDIUM+ detected in the last 7 days
// across every tracked market, plus a daily Fare Terminal Index item when
// index data is available. See docs/API.md for the field/refresh contract.
//
// Iterates listTrackedMarkets() + getMarketEvents() (both already-exported
// read-layer functions) rather than a new cross-market query, since this
// work package doesn't own lib/markets/queries.ts — see that file's header
// comment for why it's the sole DB read layer for app/api/**.

import { getDatasetAnchor, getMarketEvents, listTrackedMarkets } from '@/lib/markets/queries';
import { getIndexToday } from '@/lib/markets/index-series';
import { buildEventDescription, buildEventTitle, buildRssXml, marketPageUrl, resolveSiteUrl, type RssItem } from '@/lib/markets/share';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAY_MS = 86_400_000;
const SEVERITY_RANK: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export async function GET() {
  const siteUrl = resolveSiteUrl();
  const anchor = getDatasetAnchor();
  const since = anchor - 7 * DAY_MS;

  const tracked = listTrackedMarkets(500);
  const items: RssItem[] = [];

  for (const market of tracked) {
    const events = getMarketEvents(market.slug, { since, limit: 50 }).filter(
      (e) => SEVERITY_RANK[e.severity] >= SEVERITY_RANK.MEDIUM
    );
    const link = marketPageUrl(siteUrl, market.origin, market.destination);

    for (const event of events) {
      items.push({
        title: buildEventTitle(market.origin, market.destination, event),
        link,
        guid: `${link}#event-${event.id}`,
        pubDateMs: event.eventStartAt,
        description: buildEventDescription(event),
      });
    }
  }

  const indexToday = getIndexToday();
  if (indexToday) {
    const changeText =
      indexToday.changePct1d !== null
        ? `${indexToday.changePct1d >= 0 ? '+' : ''}${indexToday.changePct1d.toFixed(1)}% vs. the prior day`
        : 'no prior-day comparison yet';
    items.push({
      title: `Fare Terminal Index: ${indexToday.value.toFixed(1)} (${changeText})`,
      link: `${siteUrl}/`,
      // Index items are keyed by value+methodology rather than a calendar
      // date — index_values doesn't expose one here — so the guid changes
      // whenever the value itself changes, which is the only thing that
      // actually makes a new index item worth surfacing in a feed reader.
      guid: `${siteUrl}/#index-${indexToday.value.toFixed(2)}`,
      pubDateMs: anchor,
      description: `${indexToday.methodologyNote} Current value ${indexToday.value.toFixed(1)}, ${changeText}${
        indexToday.changePct7d !== null
          ? `, ${indexToday.changePct7d >= 0 ? '+' : ''}${indexToday.changePct7d.toFixed(1)}% vs. 7 days ago`
          : ''
      }.`,
    });
  }

  items.sort((a, b) => b.pubDateMs - a.pubDateMs);

  const xml = buildRssXml({
    title: 'Fare Terminal — Market Pulse',
    link: `${siteUrl}/`,
    description:
      'Notable airfare market events (price drops, carrier moves, volatility spikes, and more) across every route Fare Terminal tracks, plus a daily Fare Terminal Index update. Cached/aggregated observed data — not live quotes; see /methodology.',
    selfUrl: `${siteUrl}/feed/market-pulse.xml`,
    items,
    generatedAtMs: Date.now(),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
    },
  });
}
