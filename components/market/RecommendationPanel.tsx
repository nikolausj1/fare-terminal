import Link from 'next/link';

import { ConfidenceChip, RecommendationBadge } from '@/components/ui/Badge';
import { Disclosure } from '@/components/ui/Disclosure';
import { Panel } from '@/components/ui/Panel';
import { ACTION_PHRASE } from '@/domain/analyst/labelPhrases';
import type { RecommendationOutput } from '@/domain/types';

/** Full recommendation panel with the "Why this recommendation?" disclosure
 * split into three distinct subsections per PRD §25: Observed (facts),
 * Inferred (interpretation, each item confidence-tagged), and
 * Counterevidence & limitations (merged). When the label is
 * INSUFFICIENT_DATA, no buy/wait advice is shown — only the gate
 * failure(s), surfaced via `limitations`. */
export function RecommendationPanel({ recommendation }: { recommendation: RecommendationOutput | null }) {
  if (!recommendation) {
    return (
      <Panel title="Recommendation" titleId="recommendation-title">
        <p className="text-sm text-[var(--text-tertiary)]">No recommendation available yet.</p>
      </Panel>
    );
  }

  const { label, confidence, observedFacts, inferences, counterEvidence, limitations, methodologyVersion } = recommendation;
  const isInsufficient = label === 'INSUFFICIENT_DATA';
  const summaryText = recommendation.summary.trim().length > 0 ? recommendation.summary : ACTION_PHRASE[label];
  const counterAndLimitations = [...counterEvidence, ...limitations];

  return (
    <Panel title="Recommendation" titleId="recommendation-title">
      <div className="flex flex-wrap items-center gap-2">
        <RecommendationBadge label={label} />
        <ConfidenceChip level={confidence} />
      </div>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">{summaryText}</p>

      {isInsufficient && limitations.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-[var(--border-strong)] bg-white/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Why no recommendation
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-[var(--text-secondary)]">
            {limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      <Disclosure summary="Why this recommendation?" className="mt-3">
        <div className="flex flex-col gap-4">
          <section aria-labelledby="observed-heading">
            <h3 id="observed-heading" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              <span aria-hidden="true">👁</span> Observed
            </h3>
            {observedFacts.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--text-primary)]">
                {observedFacts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-tertiary)]">No observed facts recorded.</p>
            )}
          </section>

          {!isInsufficient && (
            <section aria-labelledby="inferred-heading">
              <h3 id="inferred-heading" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                <span aria-hidden="true">🔍</span> Inferred
              </h3>
              {inferences.length > 0 ? (
                <ul className="space-y-1.5">
                  {inferences.map((inf, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm italic text-[var(--text-secondary)]">
                      <span>{inf.text}</span>
                      <ConfidenceChip level={inf.confidence} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--text-tertiary)]">No inferences recorded.</p>
              )}
            </section>
          )}

          <section aria-labelledby="counterevidence-heading">
            <h3
              id="counterevidence-heading"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              <span aria-hidden="true">⚖</span> Counterevidence &amp; limitations
            </h3>
            {counterAndLimitations.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--text-secondary)]">
                {counterAndLimitations.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-tertiary)]">None noted.</p>
            )}
          </section>

          <p className="text-xs text-[var(--text-tertiary)]">
            Methodology version {methodologyVersion}.{' '}
            <Link href="/methodology#recommendations" className="text-[var(--accent)] hover:underline">
              Read the full methodology
            </Link>
            .
          </p>
        </div>
      </Disclosure>
    </Panel>
  );
}
