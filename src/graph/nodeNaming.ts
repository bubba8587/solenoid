// Shared by the live nodeNameStore and the pure textForm writer so both name nodes
// by ONE algorithm.

/** Identifiers are the only names the text-form grammar can address unambiguously
 *  (`Name.output` connection refs, one name token per node line, no quoting). */
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Strips a trailing "Node", matching the constant label each class passes to
 *  `super(...)`; falls back to the raw class name. */
export function typePrefix(ctorName: string): string {
  const stripped = ctorName.replace(/Node$/, "");
  return stripped.length > 0 ? stripped : ctorName || "Node";
}

/** Returns the chosen name plus the checkpoint to store for the NEXT call, so a
 *  monotonic per-prefix counter never reuses a number even after names are freed. */
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

/** Lets a restored explicit name "claim" its number so later defaults skip past it. */
export function counterCheckpoint(name: string): { prefix: string; next: number } | null {
  const m = /^(.*)_(\d+)$/.exec(name);
  if (!m) return null;
  return { prefix: m[1], next: Number(m[2]) + 1 };
}
