// Single source of truth for "now" across demo/seed code. Lets a demo be
// pinned to a fixed instant (DEMO_NOW env var, ISO-8601 or anything
// Date.parse accepts) so scenario event windows ("last 48h", "last 72h",
// ...) stay stable across a seed run and later live provider queries. Falls
// back to the real clock when DEMO_NOW is unset.

export function getNow(): number {
  const raw = process.env.DEMO_NOW;
  if (raw) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}
