// The load path's risky decisions as pure functions; keep it rete/DOM/storage-free.

// Bump in lockstep with SavedGraph.v. Exactly ONE format exists at a time: the loader
// refuses any other version — newer for forward safety, older because there is no
// backward migration (pre-alpha).
export const CURRENT_SAVE_VERSION = 2;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): ValidationResult => ({ ok: false, reason });

/** Structural validation, run BEFORE the destructive load clears the current graph. Only
 *  the "right kind of object at all" gate — unknown types and bad cables are load-time. */
export function validateSavedGraph(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) return fail("not a graph object");
  const g = data as Record<string, unknown>;

  if (typeof g.v !== "number") return fail("missing `v` (format version)");

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

// An unregistered node type loads as a PLACEHOLDER rather than dropping it and its cables;
// its socket layout is unknown, so synthesize exactly the keys the saved cables reference.

export interface SavedConnectionLike {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

/** Per unknown id, the socket keys its saved connections reference, in first-seen order. */
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

// Always write the OLDER slot and read the NEWER valid one, so a write that fails partway
// can never corrupt the only good copy. `seq` is monotonic; `null` = empty or unreadable.

export function chooseWriteSlot(seqA: number | null, seqB: number | null): "a" | "b" {
  if (seqA === null) return "a";
  if (seqB === null) return "b";
  // Ties (same ms) go to 'a' deterministically.
  return seqB < seqA ? "b" : "a";
}

export function chooseReadSlot(seqA: number | null, seqB: number | null): "a" | "b" | null {
  if (seqA === null && seqB === null) return null;
  if (seqA === null) return "b";
  if (seqB === null) return "a";
  return seqB > seqA ? "b" : "a";
}
