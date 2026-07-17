// Zod-backed structural validation plus normalization-specific semantic
// checks, applied to a raw NormalizedOfferBatch before anything downstream
// (dedupe, anomaly flagging, snapshots) ever sees it.

import { normalizedOfferSchema } from '@/domain/schemas';
import type { NormalizedOffer, NormalizedOfferBatch } from '@/domain/types';

export interface RejectedOffer {
  offer: NormalizedOffer;
  reasons: string[];
}

export interface NormalizeAndValidateResult {
  valid: NormalizedOffer[];
  rejected: RejectedOffer[];
}

/**
 * Validates every offer in a batch. An offer is rejected (with human
 * readable reasons) when it:
 *  - fails the normalizedOfferSchema shape check,
 *  - has a non-positive totalPriceMinor,
 *  - has no segments,
 *  - has any segment whose arrival is not after its departure, or
 *  - has a currency that doesn't match the query's currency.
 *
 * Offers that pass every check are returned unchanged in `valid`.
 */
export function normalizeAndValidate(
  batch: NormalizedOfferBatch
): NormalizeAndValidateResult {
  const valid: NormalizedOffer[] = [];
  const rejected: RejectedOffer[] = [];

  for (const offer of batch.offers) {
    const reasons: string[] = [];

    const parsed = normalizedOfferSchema.safeParse(offer);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        reasons.push(`schema: ${issue.path.join('.') || '(root)'} ${issue.message}`);
      }
    }

    if (offer.totalPriceMinor <= 0) {
      reasons.push('totalPriceMinor must be positive');
    }

    const segments = offer.segments ?? [];
    if (segments.length === 0) {
      reasons.push('missing segments');
    } else {
      segments.forEach((segment, index) => {
        const departure = Date.parse(segment.departureAt);
        const arrival = Date.parse(segment.arrivalAt);
        if (Number.isNaN(departure) || Number.isNaN(arrival)) {
          reasons.push(
            `segment ${index}: unparseable departure/arrival timestamp`
          );
        } else if (arrival < departure) {
          reasons.push(`segment ${index}: arrival is before departure`);
        }
      });
    }

    if (offer.currency !== batch.query.currency) {
      reasons.push(
        `currency mismatch: offer is ${offer.currency}, query is ${batch.query.currency}`
      );
    }

    if (reasons.length > 0) {
      rejected.push({ offer, reasons });
    } else {
      valid.push(offer);
    }
  }

  return { valid, rejected };
}
