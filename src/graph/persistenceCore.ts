// Pure, dependency-free core for persistence safety — no rete, no DOM, no
// localStorage. Mirrors the groupPushCore.ts pattern: the load path's risky
// decisions (is this file structurally sane? which autosave slot do we write /
// read?) live here as plain functions so they can be unit-tested headlessly,
// while persistence.ts keeps the editor/area/localStorage wiring.

// Bump in lockstep with SavedGraph.v in persistence.ts. A file claiming a
// HIGHER version is refused on load rather than opened lossily.
export const CURRENT_SAVE_VERSION = 2;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): ValidationResult => ({ ok: false, reason });

/**
 * Structural validation of a parsed save file, run BEFORE the destructive load
 * clears the current graph. Catches the shapes that would otherwise throw
 * mid-rebuild (or silently corrupt the editor) — a non-array `nodes`, a node
 * missing its `id`/`type`, a connection with a non-string endpoint. It does not
 * check that node types exist or that sockets are compatible — those are
 * tolerated at load time (unknown nodes skipped, bad connections dropped) and
 * surfaced to the user; this is only the "is it the right kind of object at
 * all" gate.
 */
export function validateSavedGraph(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) return fail("not a graph object");
  const g = data as Record<string, unknown>;

  if (g.v !== undefined && typeof g.v !== "number") return fail("`v` (format version) is not a number");

  if (!Array.isArray(g.nodes)) return fail("missing `nodes` array");
  for (let i = 0; i < g.nodes.length; i++) {
    const n = g.nodes[i];
    if (typeof n !== "object" || n === null) return fail(`node #${i} is not an object`);
    const nn = n as Record<string, unknown>;
    if (typeof nn.id !== "string") return fail(`node #${i} has no string id`);
    if (typeof nn.type !== "string") return fail(`node #${i} has no string type`);
    if (nn.x !== undefined && typeof nn.x !== "number") return fail(`node #${i} (${nn.type}) has a non-numeric x`);
    if (nn.y !== undefined && typeof nn.y !== "number") return fail(`node #${i} (${nn.type}) has a non-numeric y`);
  }

  if (g.connections !== undefined) {
    if (!Array.isArray(g.connections)) return fail("`connections` is not an array");
    for (let i = 0; i < g.connections.length; i++) {
      const c = g.connections[i];
      if (typeof c !== "object" || c === null) return fail(`connection #${i} is not an object`);
      const cc = c as Record<string, unknown>;
      for (const k of ["source", "sourceOutput", "target", "targetInput"] as const) {
        if (typeof cc[k] !== "string") return fail(`connection #${i} has no string \`${k}\``);
      }
    }
  }

  if (g.standoffs !== undefined && !Array.isArray(g.standoffs)) return fail("`standoffs` is not an array");

  return { ok: true };
}

// ─── Missing-node placeholders ───────────────────────────────────────────────
// When a saved node's `type` isn't registered (a pack that's off, or a since-
// renamed type), persistence keeps it as a placeholder instead of dropping it +
// its cables. A placeholder needs sockets for those cables to re-link, but we
// don't know the missing class's socket layout — so synthesize exactly the keys
// the saved connections reference. Pure + headless so it's unit-tested.

export interface SavedConnectionLike {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

/**
 * For each id in `unknownIds`, the input/output socket keys referenced by the
 * saved connections touching it — de-duplicated, in first-seen order. A node not
 * referenced by any connection gets no entry (a placeholder with no sockets).
 */
export function deriveMissingNodeSockets(
  unknownIds: Set<string>,
  connections: SavedConnectionLike[],
): Map<string, { inputs: string[]; outputs: string[] }> {
  const out = new Map<string, { inputs: string[]; outputs: string[] }>();
  const slot = (id: string) => {
    let s = out.get(id);
    if (!s) { s = { inputs: [], outputs: [] }; out.set(id, s); }
    return s;
  };
  for (const c of connections) {
    if (unknownIds.has(c.target)) {
      const s = slot(c.target);
      if (!s.inputs.includes(c.targetInput)) s.inputs.push(c.targetInput);
    }
    if (unknownIds.has(c.source)) {
      const s = slot(c.source);
      if (!s.outputs.includes(c.sourceOutput)) s.outputs.push(c.sourceOutput);
    }
  }
  return out;
}

// ─── Autosave slot rotation ──────────────────────────────────────────────────
// Two slots instead of one: a single slot means a write that fails partway (or
// a serialize that throws) can leave the only copy corrupt. We always write to
// the OLDER slot, so the newer copy is never the one at risk; on restore we read
// the NEWER valid slot. Each slot carries a monotonic `seq` (wall-clock ms is
// monotonic enough — newer writes have a larger seq); `null` means the slot is
// empty or unreadable.

export function chooseWriteSlot(seqA: number | null, seqB: number | null): "a" | "b" {
  if (seqA === null) return "a";
  if (seqB === null) return "b";
  // Overwrite whichever is older; ties (same ms) go to 'a' deterministically.
  return seqB < seqA ? "b" : "a";
}

export function chooseReadSlot(seqA: number | null, seqB: number | null): "a" | "b" | null {
  if (seqA === null && seqB === null) return null;
  if (seqA === null) return "b";
  if (seqB === null) return "a";
  return seqB > seqA ? "b" : "a";
}
