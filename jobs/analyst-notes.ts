// deriveAnalystNotes: for each search_definitions row's latest
// recommendations row, builds an AnalystPayload (domain/analyst#buildAnalystPayload),
// renders a note (template always; LLM attempted first when
// ANTHROPIC_API_KEY is set AND ANALYST_LLM=1), validates it
// (domain/analyst#validateNote), and stores an analyst_notes row.
//
// Never throws: any LLM failure (missing key, network error, invalid
// output) falls back to the template note, which is guaranteed to validate
// by construction (domain/analyst/labelPhrases.ts keeps ACTION_PHRASE and
// LABEL_MENTION_FRAGMENT in lockstep). The LLM path is never exercised by
// `npm test` (tests never set ANALYST_LLM=1).

import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { analystNotes, marketEvents, marketSnapshots, recommendations, searchDefinitions } from '@/db/schema';
import { buildAnalystPayload, renderTemplateNote, validateNote } from '@/domain/analyst';
import type { RecommendationOutput, SnapshotMetrics } from '@/domain/types';
import { getNow } from '@/lib/demo-time';
import { ANALYST_LLM_MODEL, generateLlmNote } from '@/lib/markets/llm';

import { isMainModule, parseDefinitionIdsArg, runCli } from './_shared';

const PROMPT_VERSION = 'analyst-note-v1';

export interface DeriveAnalystNotesSummary {
  definitionsProcessed: number;
  notesCreated: number;
  llmUsed: number;
  templateUsed: number;
  skippedNoRecommendation: number;
}

function shouldAttemptLlm(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.ANALYST_LLM === '1';
}

export async function deriveAnalystNotes(searchDefinitionId?: number): Promise<DeriveAnalystNotesSummary> {
  const defs =
    searchDefinitionId !== undefined
      ? db.select().from(searchDefinitions).where(eq(searchDefinitions.id, searchDefinitionId)).all()
      : db.select().from(searchDefinitions).all();

  const summary: DeriveAnalystNotesSummary = {
    definitionsProcessed: 0,
    notesCreated: 0,
    llmUsed: 0,
    templateUsed: 0,
    skippedNoRecommendation: 0,
  };

  const now = getNow();
  const attemptLlm = shouldAttemptLlm();

  for (const def of defs) {
    summary.definitionsProcessed += 1;

    const recRow = db
      .select()
      .from(recommendations)
      .where(eq(recommendations.searchDefinitionId, def.id))
      .orderBy(desc(recommendations.createdAt))
      .limit(1)
      .get();

    if (!recRow) {
      summary.skippedNoRecommendation += 1;
      continue;
    }

    const snapshotRow = db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.id, recRow.marketSnapshotId))
      .get();
    if (!snapshotRow) {
      summary.skippedNoRecommendation += 1;
      continue;
    }

    const recentEvents = db
      .select()
      .from(marketEvents)
      .where(eq(marketEvents.searchDefinitionId, def.id))
      .orderBy(desc(marketEvents.eventStartAt))
      .limit(5)
      .all()
      .filter((e) => e.eventStartAt <= snapshotRow.snapshotAt)
      .slice(0, 2);

    const snapshot: SnapshotMetrics = {
      benchmarkPriceMinor: snapshotRow.benchmarkPriceMinor,
      fromPriceMinor: snapshotRow.fromPriceMinor,
      medianPriceMinor: snapshotRow.medianPriceMinor,
      p25PriceMinor: snapshotRow.p25PriceMinor,
      validOfferCount: snapshotRow.validOfferCount,
      uniqueItineraryCount: snapshotRow.uniqueItineraryCount,
      carrierCount: snapshotRow.carrierCount,
      nonstopOfferCount: snapshotRow.nonstopOfferCount,
      oneStopOfferCount: snapshotRow.oneStopOfferCount,
      freshnessSeconds: snapshotRow.freshnessSeconds,
      dataQualityScore: snapshotRow.dataQualityScore,
    };

    const recommendation: RecommendationOutput = {
      label: recRow.label,
      confidence: recRow.confidence,
      score: recRow.score,
      summary: '',
      observedFacts: recRow.observedFactsJson,
      inferences: recRow.inferencesJson,
      counterEvidence: recRow.counterevidenceJson,
      limitations: recRow.limitationsJson,
      methodologyVersion: recRow.methodologyVersion,
    };

    const payload = buildAnalystPayload({
      searchDefinitionId: def.id,
      snapshotAt: snapshotRow.snapshotAt,
      snapshot,
      recommendation,
      extraObservedFacts: recentEvents.flatMap((e) => e.observedFactsJson),
    });

    let noteText = renderTemplateNote(payload);
    let generationMode: 'LLM' | 'TEMPLATE' = 'TEMPLATE';
    let modelIdentifier: string | null = null;

    if (attemptLlm) {
      try {
        const llmNote = await generateLlmNote(payload);
        const llmResult = validateNote(llmNote, payload);
        if (llmResult.ok) {
          noteText = llmNote;
          generationMode = 'LLM';
          modelIdentifier = ANALYST_LLM_MODEL;
        }
        // If the LLM note fails validation, silently keep the
        // already-rendered template note from above.
      } catch {
        // Missing key, network error, bad response shape, etc. Keep the
        // template note. Never throw.
      }
    }

    const finalValidation = validateNote(noteText, payload);
    const validationStatus = finalValidation.ok
      ? 'valid'
      : `invalid: ${finalValidation.violations.join('; ')}`;

    // Replace, don't append (same idempotency rule as recommendations).
    db.delete(analystNotes)
      .where(eq(analystNotes.marketSnapshotId, snapshotRow.id))
      .run();

    db.insert(analystNotes)
      .values({
        searchDefinitionId: def.id,
        marketSnapshotId: snapshotRow.id,
        recommendationId: recRow.id,
        noteText,
        generationMode,
        modelIdentifier,
        promptVersion: PROMPT_VERSION,
        validationStatus,
        createdAt: now,
      })
      .run();

    summary.notesCreated += 1;
    if (generationMode === 'LLM') summary.llmUsed += 1;
    else summary.templateUsed += 1;
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  const ids = parseDefinitionIdsArg(process.argv);
  void runCli(() => deriveAnalystNotes(ids?.[0]));
}
