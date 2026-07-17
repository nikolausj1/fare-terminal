/**
 * Filters rows to only those computed under a given benchmark/recommendation
 * methodology version, so history comparisons never mix incompatible
 * calculation methods (e.g. after a benchmark formula change).
 */
export function filterCompatibleSnapshots<T extends { methodologyVersion: string }>(
  rows: T[],
  version: string
): T[] {
  return rows.filter((row) => row.methodologyVersion === version);
}
