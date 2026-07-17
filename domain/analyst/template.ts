// Deterministic, non-LLM analyst note renderer. Always produces a
// grammatical, 60-140 word note covering: what happened, what it may mean,
// what to do, and confidence + caveat.

import { ACTION_PHRASE } from './labelPhrases';
import type { AnalystPayload } from './payload';

const MIN_WORDS = 60;
const MAX_WORDS = 140;
const FILLER =
  'This note reflects data observed at the time of analysis; conditions can change as new fare data is recorded.';

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function renderTemplateNote(payload: AnalystPayload): string {
  const { recommendation } = payload;

  // Beat 1: what happened (facts).
  const facts = payload.observedFacts.slice(0, 3);
  const factsSentence =
    facts.length > 0
      ? facts.join(' ')
      : 'Limited pricing data is currently available for this route.';

  // Beat 2: what it may mean (qualified inference).
  const inference = payload.inferences[0];
  const meaningSentence = inference
    ? inference.text
    : 'This pattern is consistent with normal week-to-week fare movement for this route, though the underlying cause cannot be confirmed from price data alone.';

  // Beat 3: what to do (must match the recommendation label).
  const actionSentence = ACTION_PHRASE[recommendation.label];
  const counter = recommendation.counterEvidence[0];
  const counterSentence = counter ? ` However, ${counter}` : '';

  // Beat 4: confidence + caveat.
  const limitation =
    payload.limitations[0] ??
    'This assessment reflects only the data observed so far and may change as new offers are recorded.';
  const confidenceSentence = `Confidence in this read is ${recommendation.confidence.toLowerCase()}. ${limitation}`;

  let note = [
    factsSentence,
    meaningSentence,
    `${actionSentence}${counterSentence}`,
    confidenceSentence,
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Enforce the 60-140 word budget regardless of how sparse or verbose the
  // payload was, so the template output always validates.
  if (wordCount(note) > MAX_WORDS) {
    const words = note.split(/\s+/).slice(0, MAX_WORDS);
    note = words.join(' ');
    if (!/[.!?]$/.test(note)) note += '.';
  } else {
    while (wordCount(note) < MIN_WORDS) {
      note = `${note} ${FILLER}`;
    }
    if (wordCount(note) > MAX_WORDS) {
      const words = note.split(/\s+/).slice(0, MAX_WORDS);
      note = words.join(' ');
      if (!/[.!?]$/.test(note)) note += '.';
    }
  }

  return note;
}
