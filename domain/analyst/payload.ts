// Assembles the structured input handed to the note renderer (template or,
// eventually, an LLM prompt) from the outputs of the other engines.

import type {
  ConfidenceLevel,
  RecommendationOutput,
  SnapshotMetrics,
} from '@/domain/types';

export interface AnalystPayload {
  searchDefinitionId: number;
  snapshotAt: number;
  snapshot: SnapshotMetrics;
  recommendation: RecommendationOutput;
  observedFacts: string[];
  inferences: { text: string; confidence: ConfidenceLevel }[];
  limitations: string[];
}

export interface BuildAnalystPayloadInput {
  searchDefinitionId: number;
  snapshotAt: number;
  snapshot: SnapshotMetrics;
  recommendation: RecommendationOutput;
  /** Extra numeric facts pulled from recent MarketEvents, if any. */
  extraObservedFacts?: string[];
  extraInferences?: { text: string; confidence: ConfidenceLevel }[];
  extraLimitations?: string[];
}

/**
 * Combines the recommendation's own observedFacts/inferences/limitations
 * with any extra ones the caller supplies (e.g. facts drawn from recently
 * detected MarketEvents) into a single payload for the note renderer.
 */
export function buildAnalystPayload(
  input: BuildAnalystPayloadInput
): AnalystPayload {
  return {
    searchDefinitionId: input.searchDefinitionId,
    snapshotAt: input.snapshotAt,
    snapshot: input.snapshot,
    recommendation: input.recommendation,
    observedFacts: [
      ...input.recommendation.observedFacts,
      ...(input.extraObservedFacts ?? []),
    ],
    inferences: [
      ...input.recommendation.inferences,
      ...(input.extraInferences ?? []),
    ],
    limitations: [
      ...input.recommendation.limitations,
      ...(input.extraLimitations ?? []),
    ],
  };
}
