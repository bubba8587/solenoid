// [[C19]] namingModel
// Shared by nodeNameStore and the pure textForm writer, so both name nodes by one algorithm.

/** Identifiers are the only names the text form can address unambiguously (`Name.output`, no quoting). */
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function typePrefix(ctorName: string): string {
  const stripped = ctorName.replace(/Node$/, "");
  return stripped.length > 0 ? stripped : ctorName || "Node";
}

/** Returns the next checkpoint too, so the per-prefix counter never reuses a number after names are freed. */
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

export function counterCheckpoint(name: string): { prefix: string; next: number } | null {
  const m = /^(.*)_(\d+)$/.exec(name);
  if (!m) return null;
  return { prefix: m[1], next: Number(m[2]) + 1 };
}
