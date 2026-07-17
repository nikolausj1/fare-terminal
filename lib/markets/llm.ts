// Thin adapter around the Anthropic Messages API for LLM-generated analyst
// notes. Only called from jobs/analyst-notes.ts, and only when
// ANTHROPIC_API_KEY is set AND ANALYST_LLM=1 — never in tests (tests never
// set ANALYST_LLM=1, so this module's fetch() call is never exercised by
// `npm test`).
//
// This function is allowed to throw (network errors, missing key, malformed
// response, etc.) — jobs/analyst-notes.ts wraps every call in a try/catch
// and falls back to the template renderer on any failure, so "never throw"
// is a property of the job, not of this adapter.

import type { AnalystPayload } from '@/domain/analyst';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
export const ANALYST_LLM_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

function buildPrompt(payload: AnalystPayload): string {
  const { recommendation } = payload;
  return [
    'You are a market analyst writing a short note about an airfare market for a fare-tracking app.',
    'Write a single paragraph, 60-140 words, covering in order: (1) what happened, using only the observed facts below, (2) what it may mean, (3) a recommendation consistent with the label below, (4) a confidence statement plus a caveat.',
    `Recommendation label: ${recommendation.label} (confidence: ${recommendation.confidence}).`,
    `Observed facts: ${payload.observedFacts.join(' ')}`,
    `Inferences: ${payload.inferences.map((i) => i.text).join(' ') || '(none)'}`,
    `Limitations: ${payload.limitations.join(' ') || '(none)'}`,
    'Do not state any number that is not present above. Do not use the words "guaranteed", "definitely", "always", "will rise", or "will fall". Output only the note text, no preamble.',
  ].join('\n');
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
}

/** Calls the Anthropic Messages API and returns the generated note text.
 * Throws on any failure (missing key, network error, non-2xx response,
 * empty/malformed content) — see module docstring for why that's fine. */
export async function generateLlmNote(payload: AnalystPayload): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANALYST_LLM_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [{ role: 'user', content: buildPrompt(payload) }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const text = data.content?.find((block) => block.type === 'text')?.text;
  if (!text || text.trim().length === 0) {
    throw new Error('Anthropic API returned no text content');
  }
  return text.trim();
}
