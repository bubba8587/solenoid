// Pure helpers for the stable node-name scheme (the addressable model). Shared by
// the live nodeNameStore (module-level, keyed by rete's ephemeral id) and the pure
// textForm writer (a plain SavedGraph, no live nodes) so both use ONE algorithm.

/** Identifiers are the only names the text-form grammar can address unambiguously
 *  (`Name.output` connection refs, one name token per node line, no quoting). */
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Default name prefix for a node class: strip a trailing "Node" (the near-universal
 *  class-name suffix — `FilterNode` → `Filter`, matching the constant label each class
 *  already passes to `super(...)`) and fall back to the raw class name otherwise. */
export function typePrefix(ctorName: string): string {
  const stripped = ctorName.replace(/Node$/, "");
  return stripped.length > 0 ? stripped : ctorName || "Node";
}

/** Next unused `${prefix}_${n}` name, starting the search at `startAt` (a counter
 *  checkpoint) and skipping anything `taken` reports as already in use. Returns the
 *  chosen name plus the checkpoint to store for the *next* call (so a monotonic
 *  per-prefix counter never reuses a number, even after names are freed). */
export function nextAvailableName(
  prefix: string,
  taken: (name: string) => boolean,
  startAt = 1,
): { name: string; next: number } {
  let n = Math.max(1, startAt);
  let name = `${prefix}_${n}`;
  while (taken(name)) {
    n++;
    name = `${prefix}_${n}`;
  }
  return { name, next: n + 1 };
}

/** If `name` matches `<prefix>_<digits>`, the counter checkpoint a future default
 *  for that prefix should start from — so restoring a saved/explicit name "claims"
 *  its number and later auto-generated names skip past it. */
export function counterCheckpoint(name: string): { prefix: string; next: number } | null {
  const m = /^(.*)_(\d+)$/.exec(name);
  if (!m) return null;
  return { prefix: m[1], next: Number(m[2]) + 1 };
}
