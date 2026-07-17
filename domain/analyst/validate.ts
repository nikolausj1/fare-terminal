// Validates a rendered analyst note (template OR LLM-generated) against
// its source payload before it's persisted/shown: every number in the note
// must be traceable to the payload, no hype/certainty language, and the
// note must actually state the recommendation.

import { LABEL_MENTION_FRAGMENT } from './labelPhrases';
import type { AnalystPayload } from './payload';

const BANNED_PHRASES = [
  'guaranteed',
  'definitely',
  'always',
  'will rise',
  'will fall',
];

// Tolerance for float-formatting drift (e.g. toFixed(2) vs a raw score).
const NUMBER_TOLERANCE = 0.5;

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(\.\d+)?/g) ?? [];
  return matches.map(Number);
}

function payloadCorpus(payload: AnalystPayload): string {
  return [
    ...payload.observedFacts,
    ...payload.inferences.map((i) => i.text),
    ...payload.limitations,
    ...payload.recommendation.observedFacts,
    ...payload.recommendation.inferences.map((i) => i.text),
    ...payload.recommendation.counterEvidence,
    ...payload.recommendation.limitations,
    String(payload.recommendation.score),
  ].join(' ');
}

export interface ValidateNoteResult {
  ok: boolean;
  violations: string[];
}

export function validateNote(
  note: string,
  payload: AnalystPayload
): ValidateNoteResult {
  const violations: string[] = [];
  const lowerNote = note.toLowerCase();

  for (const phrase of BANNED_PHRASES) {
    if (lowerNote.includes(phrase)) {
      violations.push(`banned phrase: "${phrase}"`);
    }
  }

  const fragment = LABEL_MENTION_FRAGMENT[payload.recommendation.label];
  if (!fragment || !lowerNote.includes(fragment)) {
    violations.push(
      `note does not mention the plain-English equivalent of label ${payload.recommendation.label}`
    );
  }

  const payloadNumbers = extractNumbers(payloadCorpus(payload));
  const noteNumbers = extractNumbers(note);
  for (const n of noteNumbers) {
    const found = payloadNumbers.some(
      (p) => Math.abs(p - n) <= NUMBER_TOLERANCE
    );
    if (!found) {
      violations.push(`number ${n} in note is not traceable to the payload`);
    }
  }

  const wordCount = note.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 60 || wordCount > 140) {
    violations.push(`word count ${wordCount} is outside the 60-140 range`);
  }

  return { ok: violations.length === 0, violations };
}
