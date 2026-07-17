import type { Metadata } from 'next';
import Link from 'next/link';

import { config } from '@/domain/config';

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How Fare Terminal computes benchmark prices, fair value, percentiles, recommendations, and event detection — and what the data can and cannot tell you.',
};

const TOC = [
  { id: 'why-hard', label: 'Why airfare comparisons are hard' },
  { id: 'market-vs-trip', label: 'Market view vs. trip view' },
  { id: 'benchmark', label: 'The benchmark price' },
  { id: 'from-price', label: 'The from price' },
  { id: 'compatible-history', label: 'Compatible history & methodology versioning' },
  { id: 'percentile', label: 'Percentile' },
  { id: 'fair-value', label: 'Fair value band' },
  { id: 'recommendations', label: 'Recommendation labels & scoring' },
  { id: 'confidence', label: 'Confidence vs. strength' },
  { id: 'events', label: 'Event taxonomy' },
  { id: 'carrier-match', label: 'On "possible carrier match" wording' },
  { id: 'freshness', label: 'Freshness & staleness' },
  { id: 'data-quality', label: 'Data quality score' },
  { id: 'providers', label: 'Provider limitations' },
  { id: 'demo-data', label: 'Demo data labeling' },
  { id: 'no-guarantee', label: 'No guarantees' },
];

export default function MethodologyPage() {
  const b = config.benchmark;
  const h = config.history;
  const rt = config.recommendationThresholds;
  const rs = config.recommendationScoring;
  const fr = config.freshness;
  const et = config.eventThresholds;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">Methodology</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          What every number on this site means, how it&apos;s calculated, and where it falls short. Fare
          Terminal only ever states what was observed and clearly labels anything inferred.
        </p>
      </header>

      <nav aria-label="Methodology contents" className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Contents</p>
        <ol className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {TOC.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="text-[var(--accent)] hover:underline">
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-8 text-sm leading-relaxed text-[var(--text-primary)]">
        <section id="why-hard" aria-labelledby="why-hard-h">
          <h2 id="why-hard-h" className="mb-2 text-lg font-semibold">
            Why airfare comparisons are hard
          </h2>
          <p>
            Airfare is not a single, stable price. The same route can be quoted differently by different
            sellers within minutes, seat inventory changes as fares sell, fare rules and included baggage
            vary by fare brand, and &quot;the price&quot; often depends on exactly which dates you search. A
            single quote tells you almost nothing about whether that price is unusual, expected, or a
            once-in-a-month opportunity. Fare Terminal exists to answer that question at the{' '}
            <em>market</em> level: given everything observed for a route recently, is the current price
            high, low, or normal — and how confident should you be in that read?
          </p>
        </section>

        <section id="market-vs-trip" aria-labelledby="market-vs-trip-h">
          <h2 id="market-vs-trip-h" className="mb-2 text-lg font-semibold">
            Market view vs. trip view
          </h2>
          <p>
            Every route tracked here is a <strong>market</strong> — an origin/destination airport pair,
            observed repeatedly over time under one of two search modes. A <strong>flexible</strong> market
            aggregates offers across a rolling departure window (currently {config.demoDefaults.flexibleWindowMinDays}
            –{config.demoDefaults.flexibleWindowMaxDays} days out, {config.demoDefaults.stayMinNights}–
            {config.demoDefaults.stayMaxNights} night stays for round trips), which is the best signal for
            &quot;is this route generally cheap right now.&quot; An <strong>exact</strong> market repeats the
            same specific depart/return dates over time, which answers a narrower question: is{' '}
            <em>this trip</em> currently priced well relative to its own history. They are tracked as
            separate series and are never averaged together — see{' '}
            <a href="#compatible-history" className="text-[var(--accent)] hover:underline">
              compatible history
            </a>{' '}
            below.
          </p>
        </section>

        <section id="benchmark" aria-labelledby="benchmark-h">
          <h2 id="benchmark-h" className="mb-2 text-lg font-semibold">
            The benchmark price
          </h2>
          <p>
            The <strong>current benchmark</strong> is the median of the {b.lowOfferSetSize} lowest valid,
            unique offers observed in the current window (median of fewer if fewer than {b.lowOfferSetSize}{' '}
            valid offers exist). We use a small low-price median rather than the single cheapest fare
            because one offer can be a data glitch, an expiring fare, or simply unavailable a minute later —
            a median of the cheapest handful is far more stable while still representing what a
            price-conscious shopper would actually see. &quot;Valid&quot; excludes expired offers and offers
            flagged as likely data anomalies (see{' '}
            <a href="#data-quality" className="text-[var(--accent)] hover:underline">
              data quality
            </a>
            ).
          </p>
        </section>

        <section id="from-price" aria-labelledby="from-price-h">
          <h2 id="from-price-h" className="mb-2 text-lg font-semibold">
            The from price
          </h2>
          <p>
            The <strong>from price</strong>{' '}
            is simply the single cheapest valid offer observed — the
            &quot;starting at&quot; number you&apos;d see advertised elsewhere. It&apos;s shown alongside the
            benchmark rather than in place of it because the from price is more volatile (a single seat
            selling out changes it) and easier to game; the benchmark is the more trustworthy signal for
            &quot;is this market cheap,&quot; while the from price answers &quot;what&apos;s the best single
            deal right now.&quot;
          </p>
        </section>

        <section id="compatible-history" aria-labelledby="compatible-history-h">
          <h2 id="compatible-history-h" className="mb-2 text-lg font-semibold">
            Compatible history &amp; methodology versioning
          </h2>
          <p>
            Every derived snapshot records the methodology version that produced it (currently{' '}
            <code className="rounded bg-white/5 px-1 py-0.5">{b.methodologyVersion}</code>). Percentile,
            fair value, and recommendation calculations only ever compare snapshots computed under the{' '}
            <em>same</em> methodology version — if the benchmark formula changes in the future, old
            snapshots are never silently mixed with new ones. This means a methodology change temporarily
            shrinks available history (and can trigger{' '}
            <Link href="#recommendations" className="text-[var(--accent)] hover:underline">
              insufficient data
            </Link>{' '}
            states) rather than quietly comparing apples to oranges.
          </p>
        </section>

        <section id="percentile" aria-labelledby="percentile-h">
          <h2 id="percentile-h" className="mb-2 text-lg font-semibold">
            Percentile
          </h2>
          <p>
            The percentile sentence (&quot;cheaper than X% of observed history&quot;) is the share of this
            market&apos;s compatible historical benchmark prices that are strictly higher than today&apos;s.
            100% means today is the cheapest this market has ever been observed; 0% means nothing in
            history was pricier than today. It requires no minimum history to compute, but reads as more
            meaningful the longer a market has been tracked.
          </p>
        </section>

        <section id="fair-value" aria-labelledby="fair-value-h">
          <h2 id="fair-value-h" className="mb-2 text-lg font-semibold">
            Fair value band
          </h2>
          <p>
            The fair value band is a robust statistical range, not a &quot;should cost&quot; opinion: center
            = median of compatible historical benchmark prices; half-width = {h.fairValueMadK} ×
            1.4826 × the median absolute deviation (MAD) of that same history. MAD-based bands are used
            instead of a mean ± standard deviation because airfare history is skewed and has real outliers
            (fare sales, data glitches) that would distort a mean-based band; MAD is far less sensitive to
            those outliers. The band only renders once at least {h.minHistoryForFairValue} compatible
            historical snapshots exist — below that, the estimate isn&apos;t considered trustworthy and the
            UI says so explicitly rather than showing a shaky range.
          </p>
        </section>

        <section id="recommendations" aria-labelledby="recommendations-h">
          <h2 id="recommendations-h" className="mb-2 text-lg font-semibold">
            Recommendation labels &amp; scoring
          </h2>
          <p>
            Each market gets a composite score from five signed dimensions — historical value (based on
            percentile), 7-day momentum, departure-date urgency, offer-supply trend, and a volatility
            penalty — each clamped to a bounded range so no single factor can dominate. The label is read
            off the total score:
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                  <th scope="col" className="py-1.5 pr-3">
                    Label
                  </th>
                  <th scope="col" className="py-1.5">
                    Score range
                  </th>
                </tr>
              </thead>
              <tbody className="text-[var(--text-secondary)]">
                <tr className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Buy</td>
                  <td className="num py-1.5">&ge; {rt.buy}</td>
                </tr>
                <tr className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Lean buy</td>
                  <td className="num py-1.5">
                    {rt.leanBuyMin} – {rt.leanBuyMax}
                  </td>
                </tr>
                <tr className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Neutral</td>
                  <td className="num py-1.5">
                    {rt.neutralMin} – {rt.neutralMax}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Wait</td>
                  <td className="num py-1.5">&le; {rt.wait}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            A market is instead marked <strong>insufficient data</strong> — with no buy/wait advice at all —
            whenever it fails any of three gates: fewer than {rs.minHistoryForRecommendation} compatible
            historical snapshots, a data quality score below {rs.minDataQualityScore}, or data staler than
            the freshness limit below. The UI states exactly which gate(s) failed rather than guessing.
          </p>
        </section>

        <section id="confidence" aria-labelledby="confidence-h">
          <h2 id="confidence-h" className="mb-2 text-lg font-semibold">
            Confidence vs. strength
          </h2>
          <p>
            The recommendation <em>label</em> (buy/lean buy/neutral/wait) is about the direction and
            strength of the signal; <strong>confidence</strong> (low/moderate/high) is a separate axis about
            how much to trust that signal. High confidence requires data quality ≥ {rs.confidenceBands.highMinQuality},
            at least {rs.confidenceBands.highMinHistory} compatible historical snapshots, and volatility ≤{' '}
            {rs.confidenceBands.highMaxVolatilityPct}%; moderate confidence relaxes those to{' '}
            {rs.confidenceBands.moderateMinQuality}, {rs.confidenceBands.moderateMinHistory} snapshots, and{' '}
            {rs.confidenceBands.moderateMaxVolatilityPct}% respectively. A strong &quot;buy&quot; score with
            low confidence is a real, if noisy, signal — not a contradiction.
          </p>
        </section>

        <section id="events" aria-labelledby="events-h">
          <h2 id="events-h" className="mb-2 text-lg font-semibold">
            Event taxonomy
          </h2>
          <p>
            Every event separates what was <strong>observed</strong> (a plain factual statement: a price
            moved, an offer count changed, a carrier appeared or disappeared from the cheapest set) from
            what is <strong>inferred</strong> (an interpretation of why it might matter), and every inference
            carries its own confidence level.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                  <th scope="col" className="py-1.5 pr-3">
                    Category
                  </th>
                  <th scope="col" className="py-1.5">
                    Event types
                  </th>
                </tr>
              </thead>
              <tbody className="text-[var(--text-secondary)]">
                <tr className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Price</td>
                  <td className="py-1.5">Price drop, price increase, new historical low, low-fare set changed</td>
                </tr>
                <tr className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Carrier</td>
                  <td className="py-1.5">Carrier entered/left low set, possible carrier match</td>
                </tr>
                <tr className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Fare product</td>
                  <td className="py-1.5">Fare product appeared/disappeared</td>
                </tr>
                <tr className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Volume</td>
                  <td className="py-1.5">Offer count surge/contraction</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">Anomaly</td>
                  <td className="py-1.5">Volatility spike, data anomaly</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            Same-type events within {et.eventCooldownHours} hours of each other coalesce into one episode
            (the stored event&apos;s end time extends) rather than spamming the timeline with near-duplicate
            entries; a severity escalation breaks through that cooldown as a new event.
          </p>
        </section>

        <section id="carrier-match" aria-labelledby="carrier-match-h">
          <h2 id="carrier-match-h" className="mb-2 text-lg font-semibold">
            On &quot;possible carrier match&quot; wording
          </h2>
          <p>
            When two or more carriers&apos; cheapest fares move the same direction within a short window
            (currently {et.carrierMatchWindowHours} hours) by at least {et.carrierMatchMinMovePct}%, Fare
            Terminal surfaces it as a <strong>possible</strong>{' '}
            carrier match — worded as &quot;consistent
            with coordinated pricing but does not confirm it.&quot; This is deliberate: simultaneous price
            moves can reflect genuine competitive matching, shared underlying cost/demand signals, or plain
            coincidence, and the data available here cannot distinguish between those causes. The event is
            never labeled as confirmed competitive behavior.
          </p>
        </section>

        <section id="freshness" aria-labelledby="freshness-h">
          <h2 id="freshness-h" className="mb-2 text-lg font-semibold">
            Freshness &amp; staleness
          </h2>
          <p>
            Data is considered stale once it is more than {fr.staleAfterMinutes} minutes ({(fr.staleAfterMinutes / 60).toFixed(1)}{' '}
            hours) old. Every price and timestamp on this site is labeled with when it was last updated, and
            a stale warning is shown explicitly rather than silently presenting old data as current.
          </p>
        </section>

        <section id="data-quality" aria-labelledby="data-quality-h">
          <h2 id="data-quality-h" className="mb-2 text-lg font-semibold">
            Data quality score
          </h2>
          <p>
            Each snapshot gets a 0–1 data quality score: the unweighted average of an offer-count component
            (full credit at {config.benchmark.minOffersForFullQuality}+ valid offers), a freshness component,
            and a cleanliness component (share of the input batch that wasn&apos;t expired or flagged as a
            likely anomaly). Low-quality snapshots are excluded from Market Pulse cards and can trigger
            insufficient-data recommendation states.
          </p>
        </section>

        <section id="providers" aria-labelledby="providers-h">
          <h2 id="providers-h" className="mb-2 text-lg font-semibold">
            Provider limitations
          </h2>
          <p>
            When configured against a real data source (TravelPayouts / Aviasales), Fare Terminal is reading{' '}
            <strong>cached, aggregated &quot;cheapest price seen&quot; observations</strong>{' '}
            sourced from
            real traveler searches — not a live GDS/NDC quote triggered on demand. Those cache entries can be
            up to roughly 48 hours old, carry no fare-brand/seat-count/booking-class detail, and their
            per-leg segment data is synthesized (not a verified itinerary) to fit this app&apos;s shared offer
            shape. Every such offer is flagged accordingly in its quality flags, and none of it should be
            read as &quot;bookable right now at this price.&quot; See{' '}
            <code className="rounded bg-white/5 px-1 py-0.5">docs/PROVIDERS.md</code> in the repository for
            the full adapter-level detail.
          </p>
        </section>

        <section id="demo-data" aria-labelledby="demo-data-h">
          <h2 id="demo-data-h" className="mb-2 text-lg font-semibold">
            Demo data labeling
          </h2>
          <p>
            This deployment may be running entirely on synthetic, deterministic demo data (fictional
            carriers, real airport codes) rather than a live provider. Whenever that&apos;s the case, a
            persistent banner reading &quot;Synthetic demo data. Not current airfare.&quot; is shown at the
            top of every page, and freshness is computed relative to the dataset&apos;s own anchor time
            rather than the real clock, so a demo deployment never falsely appears to have gone stale.
          </p>
        </section>

        <section id="no-guarantee" aria-labelledby="no-guarantee-h">
          <h2 id="no-guarantee-h" className="mb-2 text-lg font-semibold">
            No guarantees
          </h2>
          <p>
            Nothing on Fare Terminal is a guarantee, a live quote, or booking advice. Prices change
            continuously and can differ from what&apos;s shown here by the time you check an airline or
            travel site directly. Recommendations are a statistical read of historical patterns, not a
            prediction — treat every label, percentile, and fair-value band as one input among many, always
            verify the actual price before booking, and see the{' '}
            <Link href="/about" className="text-[var(--accent)] hover:underline">
              about page
            </Link>{' '}
            for what this tool is and isn&apos;t.
          </p>
        </section>
      </div>
    </div>
  );
}
