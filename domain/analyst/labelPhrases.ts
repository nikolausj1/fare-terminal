// Shared plain-English mapping for RecommendationLabel, used by both the
// template renderer (to state the recommendation) and the validator (to
// confirm the note actually states it). Keeping ACTION_PHRASE and
// LABEL_MENTION_FRAGMENT in one place, with each fragment a verbatim
// substring of its phrase, guarantees renderTemplateNote's output always
// passes the "mentions the label" check in validateNote.

import type { RecommendationLabel } from '@/domain/types';

export const ACTION_PHRASE: Record<RecommendationLabel, string> = {
  BUY: 'Buy now: this looks like a good time to book.',
  LEAN_BUY: 'Lean toward buying soon rather than waiting.',
  NEUTRAL:
    'Hold steady: prices are in a normal range, so there is no strong signal either way.',
  WAIT: 'Wait if you can: prices may improve, so holding off looks reasonable for now.',
  INSUFFICIENT_DATA:
    'Hold off on a recommendation: there is not yet enough data to call this with confidence.',
};

// Each fragment must be a lowercase, verbatim substring of the
// corresponding ACTION_PHRASE entry above.
export const LABEL_MENTION_FRAGMENT: Record<RecommendationLabel, string> = {
  BUY: 'good time to book',
  LEAN_BUY: 'lean toward buying',
  NEUTRAL: 'no strong signal',
  WAIT: 'holding off looks reasonable',
  INSUFFICIENT_DATA: 'not yet enough data',
};
