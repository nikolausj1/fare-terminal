// WP-F5 shareability layer: unit coverage for the pure helpers in
// lib/markets/share.ts (no DB, no ImageResponse — those are exercised via
// the build+start curl checks in the WP-F5 verification pass instead).

import { describe, expect, it } from 'vitest';

import {
  buildEventTitle,
  buildRssXml,
  buildShareMarkdown,
  escapeXml,
  sparklinePathD,
  toPublicMarketCard,
} from '@/lib/markets/share';
import type { MarketSummaryVM } from '@/lib/markets/view-models';

function baseSummary(overrides: Partial<MarketSummaryVM> = {}): MarketSummaryVM {
  return {
    definition: {
      slug: 'jfk-lhr-flexible',
      origin: 'JFK',
      destination: 'LHR',
      originCity: 'New York',
      destinationCity: 'London',
      mode: 'FLEXIBLE',
      cabin: 'ECONOMY',
      tripType: 'ROUND_TRIP',
      currency: 'USD',
      windowDescription: 'Anytime in 21-90 days, 5-9 night stay',
    },
    snapshot: {
      benchmarkPriceMinor: 41700,
      fromPriceMinor: 39900,
      medianPriceMinor: 42000,
      p25PriceMinor: 40500,
      validOfferCount: 24,
      uniqueItineraryCount: 12,
      carrierCount: 4,
      nonstopOfferCount: 6,
      oneStopOfferCount: 18,
      freshnessSeconds: 3600,
      dataQualityScore: 0.92,
      snapshotAt: 1_700_000_000_000,
    },
    change: { pct24h: -12.3, abs24hMinor: -5800, pct7d: -8.1 },
    percentile: 86,
    fairValue: null,
    recommendation: null,
    analystNote: null,
    freshness: { ageSeconds: 3600, isStale: false },
    dataQuality: 0.92,
    dataSourceMode: 'AGGREGATED_CACHED',
    demoMode: false,
    datasetAnchorAt: 1_700_000_000_000,
    priceReliable: true,
    modeFallback: null,
    ...overrides,
  };
}

describe('buildShareMarkdown', () => {
  it('formats price + 24h delta with a down glyph for a favorable (negative) move', () => {
    const md = buildShareMarkdown({
      origin: 'JFK',
      destination: 'LHR',
      url: 'https://fare-terminal.vercel.app/market/jfk/lhr',
      priceReliable: true,
      benchmarkPriceMinor: 41700,
      currency: 'USD',
      changePct24h: -12.3,
    });
    expect(md).toBe('[JFK→LHR $417 ▼12%](https://fare-terminal.vercel.app/market/jfk/lhr)');
  });

  it('uses an up glyph for a positive move', () => {
    const md = buildShareMarkdown({
      origin: 'SEA',
      destination: 'FCO',
      url: 'https://example.com/market/sea/fco',
      priceReliable: true,
      benchmarkPriceMinor: 90000,
      currency: 'USD',
      changePct24h: 4.6,
    });
    expect(md).toContain('▲5%');
  });

  it('omits the delta segment when there is no comparable prior snapshot', () => {
    const md = buildShareMarkdown({
      origin: 'JFK',
      destination: 'LHR',
      url: 'https://example.com/market/jfk/lhr',
      priceReliable: true,
      benchmarkPriceMinor: 41700,
      currency: 'USD',
      changePct24h: null,
    });
    expect(md).toBe('[JFK→LHR $417](https://example.com/market/jfk/lhr)');
  });

  it('degrades to a bare route link when the price is unreliable (never a $0)', () => {
    const md = buildShareMarkdown({
      origin: 'JFK',
      destination: 'LHR',
      url: 'https://example.com/market/jfk/lhr',
      priceReliable: false,
      benchmarkPriceMinor: 0,
      currency: 'USD',
      changePct24h: null,
    });
    expect(md).toBe('[JFK→LHR](https://example.com/market/jfk/lhr)');
    expect(md).not.toContain('$0');
  });
});

describe('toPublicMarketCard', () => {
  it('maps a reliable summary to the trimmed public shape', () => {
    const card = toPublicMarketCard(baseSummary(), 'https://fare-terminal.vercel.app');
    expect(card).toMatchObject({
      origin: 'JFK',
      destination: 'LHR',
      url: 'https://fare-terminal.vercel.app/market/jfk/lhr',
      priceReliable: true,
      benchmarkPriceMinor: 41700,
      changePct24h: -12.3,
      changePct7d: -8.1,
      percentile: 86,
      dataSourceMode: 'AGGREGATED_CACHED',
    });
  });

  it('nulls out price/delta/percentile when priceReliable is false', () => {
    const card = toPublicMarketCard(
      baseSummary({ priceReliable: false, change: null, percentile: null }),
      'https://fare-terminal.vercel.app'
    );
    expect(card.priceReliable).toBe(false);
    expect(card.benchmarkPriceMinor).toBeNull();
    expect(card.changePct24h).toBeNull();
    expect(card.changePct7d).toBeNull();
    expect(card.percentile).toBeNull();
  });
});

describe('sparklinePathD', () => {
  it('returns empty for no points', () => {
    expect(sparklinePathD([], 100, 40)).toBe('');
  });

  it('produces a flat horizontal line for a single point', () => {
    expect(sparklinePathD([100], 100, 40)).toBe('M0,20 L100,20');
  });

  it('starts with M and uses L for subsequent points, spanning the full width', () => {
    const d = sparklinePathD([100, 200, 150, 300], 90, 30, 0);
    expect(d.startsWith('M0.0,')).toBe(true);
    expect(d).toContain('L30.0,');
    expect(d).toContain('L90.0,');
    // Highest value (300) should map to y=0 (top) given padding=0.
    expect(d).toMatch(/L90\.0,0\.0$/);
  });
});

describe('escapeXml / buildRssXml', () => {
  it('escapes the five XML predefined entities', () => {
    expect(escapeXml(`Tom & Jerry's "Price drop" <50%>`)).toBe(
      'Tom &amp; Jerry&apos;s &quot;Price drop&quot; &lt;50%&gt;'
    );
  });

  it('produces a well-formed RSS 2.0 document with escaped item content', () => {
    const xml = buildRssXml({
      title: 'Fare Terminal — Market Pulse',
      link: 'https://fare-terminal.vercel.app/',
      description: 'Notable events & updates',
      selfUrl: 'https://fare-terminal.vercel.app/feed/market-pulse.xml',
      generatedAtMs: Date.parse('2026-08-01T00:00:00.000Z'),
      items: [
        {
          title: 'JFK→LHR: Price drop -12% ($417)',
          link: 'https://fare-terminal.vercel.app/market/jfk/lhr',
          guid: 'https://fare-terminal.vercel.app/market/jfk/lhr#event-1',
          pubDateMs: Date.parse('2026-07-31T12:00:00.000Z'),
          description: 'Benchmark fell 12.3% (USD 417.00) in 24h. <script>alert(1)</script>',
        },
      ],
    });

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<title>Fare Terminal — Market Pulse</title>');
    expect(xml).toContain('Notable events &amp; updates');
    expect(xml).toContain('<title>JFK→LHR: Price drop -12% ($417)</title>');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(xml).toContain('<guid isPermaLink="false">https://fare-terminal.vercel.app/market/jfk/lhr#event-1</guid>');
    // Every open tag we emit ourselves has a matching close tag.
    expect((xml.match(/<item>/g) ?? []).length).toBe((xml.match(/<\/item>/g) ?? []).length);
    expect((xml.match(/<channel>/g) ?? []).length).toBe((xml.match(/<\/channel>/g) ?? []).length);
    expect((xml.match(/<rss /g) ?? []).length).toBe((xml.match(/<\/rss>/g) ?? []).length);
  });
});

describe('buildEventTitle', () => {
  it('parses a price-drop signal out of observedFacts into a signed pct + price title', () => {
    const title = buildEventTitle('JFK', 'LHR', {
      eventType: 'PRICE_DROP',
      label: 'Price drop',
      observedFacts: [
        'Benchmark fell 12.3% (USD 417.00) in 26h.',
        'Benchmark moved from USD 475.50 to USD 417.00.',
      ],
    });
    expect(title).toBe('JFK→LHR: Price drop -12% ($417)');
  });

  it('parses a price-increase signal with a + sign', () => {
    const title = buildEventTitle('SEA', 'FCO', {
      eventType: 'PRICE_INCREASE',
      label: 'Price increase',
      observedFacts: ['Benchmark rose 15.0% (USD 900.00) in 10h.'],
    });
    expect(title).toBe('SEA→FCO: Price increase +15% ($900)');
  });

  it('falls back to label + first fact when no price signal is present', () => {
    const title = buildEventTitle('JFK', 'LHR', {
      eventType: 'CARRIER_ENTERED_LOW_SET',
      label: 'Carrier entered low set',
      observedFacts: ['Delta entered the 5-lowest-price set (not represented there previously).'],
    });
    expect(title).toBe(
      'JFK→LHR: Carrier entered low set — Delta entered the 5-lowest-price set (not represented there previously).'
    );
  });

  it('falls back to a bare label when there are no observed facts at all', () => {
    const title = buildEventTitle('JFK', 'LHR', {
      eventType: 'DATA_ANOMALY',
      label: 'Data anomaly',
      observedFacts: [],
    });
    expect(title).toBe('JFK→LHR: Data anomaly');
  });
});
