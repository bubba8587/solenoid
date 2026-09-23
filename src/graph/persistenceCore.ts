// [[C30]] saveViaTextForm, [[B12]] losslessSaves

export const CURRENT_SAVE_VERSION = 2;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): ValidationResult => ({ ok: false, reason });

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


export interface SavedConnectionLike {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

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


export function chooseWriteSlot(seqA: number | null, seqB: number | null): "a" | "b" {
  if (seqA === null) return "a";
  if (seqB === null) return "b";
  return seqB < seqA ? "b" : "a";
}

export function chooseReadSlot(seqA: number | null, seqB: number | null): "a" | "b" | null {
  if (seqA === null && seqB === null) return null;
  if (seqA === null) return "b";
  if (seqB === null) return "a";
  return seqB > seqA ? "b" : "a";
}

export interface NodeRefs { hostNodeId?: unknown; members?: unknown; steps?: unknown }

export function remapNodeRefs(target: NodeRefs, idMap: ReadonlyMap<string, string>, isLive: (id: string) => boolean): void {
  const remap = (ids: unknown[]) =>
    ids.map((m) => (typeof m === "string" ? idMap.get(m) ?? m : m)).filter((m): m is string => typeof m === "string" && isLive(m));
  if (typeof target.hostNodeId === "string" && target.hostNodeId) {
    const mapped = idMap.get(target.hostNodeId);
    if (mapped) target.hostNodeId = mapped;
  }
  if (Array.isArray(target.members)) target.members = remap(target.members);
  if (Array.isArray(target.steps)) {
    target.steps = (target.steps as Array<{ nodeIds?: unknown } | null>).map((step) =>
      step && Array.isArray(step.nodeIds) ? { ...step, nodeIds: remap(step.nodeIds) } : step);
  }
}

/** A copy of `init` with its node references (`hostNodeId`, `members`, step `nodeIds`) passed through `map`; `init` is not touched. */
export function mapNodeRefs(init: Record<string, unknown>, map: (id: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...init };
  const ids = (xs: unknown[]) => xs.map((m) => (typeof m === "string" ? map(m) : m));
  if (typeof out.hostNodeId === "string" && out.hostNodeId) out.hostNodeId = map(out.hostNodeId);
  if (Array.isArray(out.members)) out.members = ids(out.members);
  if (Array.isArray(out.steps)) {
    out.steps = (out.steps as Array<{ nodeIds?: unknown } | null>).map((s) =>
      s && Array.isArray(s.nodeIds) ? { ...s, nodeIds: ids(s.nodeIds) } : s);
  }
  return out;
}
