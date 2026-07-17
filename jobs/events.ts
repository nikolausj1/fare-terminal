// deriveEvents: walks a search_definitions row's market_snapshots
// chronologically and calls domain/events#detectEvents for each
// (current, previous) pair, storing any detected market_events rows.
//
// Idempotent via wipe+rebuild: every call deletes the definition's existing
// market_events rows first, then re-derives the full event log from
// scratch. This is simpler than trying to diff against what's already
// stored, and cheap — detectEvents is pure in-memory comparison over
// already-computed snapshots/offers, so re-deriving the whole history is
// fast even for hundreds of snapshots.

import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { marketEvents, marketSnapshots, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import { detectEvents, type SnapshotWithTime } from '@/domain/events';
import { filterCompatibleSnapshots } from '@/domain/history';
import { getNow } from '@/lib/demo-time';
import { loadOffersGroupedByRunId } from '@/lib/markets/offers';
import type { NormalizedOffer } from '@/domain/types';

import { isMainModule, parseDefinitionIdsArg, runCli } from './_shared';

export interface DeriveEventsSummary {
  definitionsProcessed: number;
  eventsCreated: number;
}

// market_snapshots rows already have camelCase fields matching
// SnapshotMetrics + snapshotAt (Drizzle maps snake_case columns to the
// camelCase JS property names declared in db/schema.ts), plus id,
// methodologyVersion, and sourceSearchRunIds, so they satisfy
// SnapshotWithTime structurally without any remapping.
type SnapshotRow = typeof marketSnapshots.$inferSelect;

export function deriveEvents(searchDefinitionId?: number): DeriveEventsSummary {
  const defs =
    searchDefinitionId !== undefined
      ? db.select().from(searchDefinitions).where(eq(searchDefinitions.id, searchDefinitionId)).all()
      : db.select().from(searchDefinitions).all();

  const summary: DeriveEventsSummary = { definitionsProcessed: 0, eventsCreated: 0 };
  const now = getNow();

  for (const def of defs) {
    summary.definitionsProcessed += 1;

    db.delete(marketEvents).where(eq(marketEvents.searchDefinitionId, def.id)).run();

    const snapshotRows = db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.searchDefinitionId, def.id))
      .orderBy(asc(marketSnapshots.snapshotAt))
      .all();

    const compatible: SnapshotRow[] = filterCompatibleSnapshots(
      snapshotRows,
      config.benchmark.methodologyVersion
    );

    const offersByRun = loadOffersGroupedByRunId(def.id);
    function offersFor(snapshot: SnapshotRow): NormalizedOffer[] {
      return snapshot.sourceSearchRunIds.flatMap((runId) => offersByRun.get(runId) ?? []);
    }

    // Episode coalescing: repeated same-type detections within the
    // cooldown window extend the stored event's end time rather than
    // creating a new row. A severity escalation starts a new event.
    const severityRank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
    const cooldownMs =
      config.eventThresholds.eventCooldownHours * 60 * 60 * 1000;
    const lastByType = new Map<
      string,
      { id: number; severity: keyof typeof severityRank; lastSeenAt: number }
    >();

    for (let i = 0; i < compatible.length; i++) {
      const current = compatible[i];
      const previous: SnapshotRow | null = i > 0 ? compatible[i - 1] : null;
      const history: SnapshotWithTime[] = i > 1 ? compatible.slice(0, i - 1) : [];

      const currentOffers = offersFor(current);
      const previousOffers = previous ? offersFor(previous) : [];

      const detected = detectEvents({
        searchDefinitionId: def.id,
        current,
        previous,
        history,
        currentOffers,
        previousOffers,
        now,
      });

      if (detected.length === 0) continue;

      const supportingRecordIds = [current.id, ...(previous ? [previous.id] : [])];

      for (const event of detected) {
        const prior = lastByType.get(event.eventType);
        const withinCooldown =
          prior !== undefined &&
          current.snapshotAt - prior.lastSeenAt <= cooldownMs;
        const escalates =
          prior !== undefined &&
          severityRank[event.severity] > severityRank[prior.severity];

        if (withinCooldown && !escalates) {
          // Same episode continuing: extend the stored event's window.
          db.update(marketEvents)
            .set({ eventEndAt: current.snapshotAt })
            .where(eq(marketEvents.id, prior.id))
            .run();
          prior.lastSeenAt = current.snapshotAt;
          continue;
        }

        const inserted = db
          .insert(marketEvents)
          .values({
            searchDefinitionId: event.searchDefinitionId,
            eventType: event.eventType,
            eventStartAt: event.eventStartAt,
            eventEndAt: event.eventEndAt ?? null,
            severity: event.severity,
            confidence: event.confidence,
            observedFactsJson: event.observedFacts,
            inferenceJson: event.inference ?? null,
            supportingRecordIds,
            detectionRuleVersion: event.detectionRuleVersion,
            createdAt: now,
          })
          .returning({ id: marketEvents.id })
          .get();

        lastByType.set(event.eventType, {
          id: inserted.id,
          severity: event.severity,
          lastSeenAt: current.snapshotAt,
        });
        summary.eventsCreated += 1;
      }
    }
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  const ids = parseDefinitionIdsArg(process.argv);
  void runCli(() => deriveEvents(ids?.[0]));
}
