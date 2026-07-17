// Deterministic itinerary identity, independent of provider/offer identity.
// Used to detect "the same flights" across providers, polling runs, and
// fare products (dedupe, benchmark low-set comparisons, event detection).

import { createHash } from 'node:crypto';
import type { Segment } from '@/domain/types';

/**
 * Deterministic fingerprint for an itinerary (an ordered list of segments).
 *
 * Built from, per segment and in segment order: operating flight number,
 * origin, destination, departure timestamp, arrival timestamp, and cabin.
 * Provider-specific identifiers (providerId, providerOfferId) and the
 * marketing flight number are deliberately excluded, so the same physical
 * itinerary sold by different providers, or under different marketing
 * numbers (codeshares), hashes identically.
 */
export function itineraryFingerprint(segments: Segment[]): string {
  const canonical = segments
    .map((segment) =>
      [
        segment.operatingFlightNumber,
        segment.origin,
        segment.destination,
        segment.departureAt,
        segment.arrivalAt,
        segment.cabin,
      ].join('|')
    )
    .join(';');

  return createHash('sha1').update(canonical).digest('hex');
}
