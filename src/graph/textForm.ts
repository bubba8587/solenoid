// The text projection (the addressable model — decided session
// in docs/subsystem-invariants.md "Addressable model"). A pure SavedGraph <-> text
// conversion — no rete, no DOM, no live editor — mirroring the persistenceCore.ts /
// groupPushCore.ts "pure core" pattern so it's unit-testable headlessly and reusable
// by both persistence.ts (JSON generation, see serializeGraph) and any future CLI/AI
// surface that reads or writes the text form directly.
//
// Grammar (one node per line, in topological/dependency order, ties broken
// alphabetically by name):
//
//   Name: Type key="literal value" lit:key=0 str:key="text" input<-Other.output
//
// - `Name:` then `Type` (both bare identifiers).
// - Then space-separated fields, each either:
//     `key=<JSON-encoded value>`      — an `init` field (canonical order below)
//     `lit:key=<JSON-encoded number>` — an inline numeric-input literal
//     `str:key=<JSON-encoded string>` — an inline text-input literal
//     `key<-SourceName.outputKey`     — an incoming connection (name-addressed)
//   Field keys are restricted to `[A-Za-z_][A-Za-z0-9_:]*` so a value can always be
//   told apart from the next field: it starts right after the first unescaped `=`
//   or `<-`, and a JSON-encoded value never contains a top-level unquoted space.
// - After the node lines: a blank "---" line, then one JSON block ("the sidecar")
//   carrying everything that ISN'T node logic — position, manual size, per-node
//   body-collapse, standoffs, pins, seedId, palette, packs, the save-format version.
//   Node/standoff/pin references in the sidecar are also name-addressed.
//
// Canonicalization (so two writes of an unmodified graph are byte-identical):
// numbers via JS's default `String(n)` (implicit in JSON.stringify for finite
// numbers — no locale formatting, no fixed padding); every node's `init` fields in
// the SAME fixed order copyPaste.ts's extractInit uses (INIT_FIELD_ORDER +
// INIT_EXTRA_FIELD_ORDER), never alphabetical-by-key or insertion-order for those;
// remaining (dynamically-keyed) init/literal fields and connections sorted
// alphabetically, which is still fully deterministic even though it isn't a
// "declared" order — there is no single declared order for a class's arbitrary
// input-row keys the way there is for the whitelisted init fields.

import type { SavedGraph, SavedNode, SavedConnection, SavedStandoff } from "./persistence";
import type { Pin } from "./pinStore";
import { INIT_FIELD_ORDER, INIT_EXTRA_FIELD_ORDER } from "./copyPaste";
import { NAME_RE, typePrefix, nextAvailableName } from "./nodeNaming";

const SEPARATOR = "---";

// ─── Name assignment (write side) ───────────────────────────────────────────────
// Every node needs a final, unique, identifier-safe name before anything else can
// be written (topo order tie-breaks on it too). Prefer the node's own saved name
// if it's valid and not already claimed by an earlier node in file order;
// otherwise synthesize a fresh type-scoped default — the same algorithm the live
// nodeNameStore uses (nodeNaming.ts), just against a local taken-set instead of
// the module singleton.
function assignNames(nodes: SavedNode[]): Map<string, string> {
  const idToName = new Map<string, string>();
  const taken = new Set<string>();
  const counters = new Map<string, number>();
  for (const sn of nodes) {
    const candidate = sn.name;
    if (typeof candidate === "string" && NAME_RE.test(candidate) && !taken.has(candidate)) {
      idToName.set(sn.id, candidate);
      taken.add(candidate);
      continue;
    }
    const prefix = typePrefix(sn.type);
    const { name, next } = nextAvailableName(prefix, (n) => taken.has(n), counters.get(prefix) ?? 1);
    counters.set(prefix, next);
    idToName.set(sn.id, name);
    taken.add(name);
  }
  return idToName;
}

// ─── Topological order ──────────────────────────────────────────────────────────
// Kahn's algorithm, picking the alphabetically-smallest-by-name ready node at each
// step. Any leftover (a dependency cycle — a runtime #CIRC! concern, not something
// the writer should choke on) is appended alphabetically by name so this never
// throws or hangs on a pathological graph.
function topoOrder(nodeIds: string[], connections: SavedConnection[], nameOf: (id: string) => string): string[] {
  const indeg = new Map<string, number>();
  for (const id of nodeIds) indeg.set(id, 0);
  const adj = new Map<string, string[]>();
  for (const c of connections) {
    if (!indeg.has(c.source) || !indeg.has(c.target)) continue; // dangling ref — ignore
    indeg.set(c.target, (indeg.get(c.target) ?? 0) + 1);
    const arr = adj.get(c.source);
    if (arr) arr.push(c.target);
    else adj.set(c.source, [c.target]);
  }
  const byName = (a: string, b: string) => {
    const na = nameOf(a), nb = nameOf(b);
    return na < nb ? -1 : na > nb ? 1 : 0;
  };
  const ready = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  const remaining = new Set(nodeIds);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(byName);
    const id = ready.shift()!;
    order.push(id);
    remaining.delete(id);
    for (const t of adj.get(id) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0) ready.push(t);
    }
  }
  const leftover = [...remaining].sort(byName);
  return [...order, ...leftover];
}

// ─── Canonical field ordering ────────────────────────────────────────────────────

function canonicalEntries(obj: Record<string, unknown>): [string, unknown][] {
  const out: [string, unknown][] = [];
  const seen = new Set<string>();
  for (const k of INIT_FIELD_ORDER) {
    if (k in obj && obj[k] !== undefined) { out.push([k, obj[k]]); seen.add(k); }
  }
  for (const k of INIT_EXTRA_FIELD_ORDER) {
    if (k in obj && obj[k] !== undefined) { out.push([k, obj[k]]); seen.add(k); }
  }
  const rest = Object.keys(obj).filter((k) => !seen.has(k) && obj[k] !== undefined).sort();
  for (const k of rest) out.push([k, obj[k]]);
  return out;
}

// ─── Field-token grammar (shared by writer + reader) ────────────────────────────

const FIELD_KEY_RE = /^([A-Za-z_][A-Za-z0-9_:]*)(=|<-)/;

function tokenizeFields(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && s[i] === " ") i++;
    if (i >= n) break;
    const start = i;
    let inStr = false;
    while (i < n) {
      const c = s[i];
      if (inStr) {
        if (c === "\\") { i += 2; continue; }
        if (c === '"') { inStr = false; i++; continue; }
        i++;
      } else {
        if (c === '"') { inStr = true; i++; continue; }
        if (c === " ") break;
        i++;
      }
    }
    tokens.push(s.slice(start, i));
  }
  return tokens;
}

function splitField(token: string): { key: string; op: "=" | "<-"; rest: string } {
  const m = FIELD_KEY_RE.exec(token);
  if (!m) throw new Error(`textForm: malformed field "${token}"`);
  return { key: m[1], op: m[2] as "=" | "<-", rest: token.slice(m[0].length) };
}

// A connection's source-output key is USER-CONTROLLED text when it comes from a
// Note's frontmatter (`unit price: 5` → an output socket keyed "unit price" —
// noteFrontmatter.ts allows spaces/dots/hyphens in keys). A bare key with a
// space shears the token in two at the tokenizer (found by probe: `in<-
// Note_1.unit price` → 'malformed field "price"' — and serializeGraph routes
// every JSON save through this writer, so it broke SAVING such a doc). Emit
// bare only when the tokenizer carries it intact (no space/quote/backslash — a
// DOT is fine, the reader splits at the FIRST dot, node names are NAME_RE-safe
// and never contain one); otherwise JSON-quote it, which tokenizeFields already
// keeps whole. (targetInput keys are class-defined identifiers by construction,
// FIELD_KEY_RE-safe — only the output side is user-controlled today.)
const BARE_OUTPUT_RE = /^[^"\\ ]+$/;
function outputToken(key: string): string {
  return BARE_OUTPUT_RE.test(key) ? key : JSON.stringify(key);
}

// ─── Writer ──────────────────────────────────────────────────────────────────────

export function writeTextForm(g: SavedGraph): string {
  const idToName = assignNames(g.nodes);
  const nameOf = (id: string) => idToName.get(id) ?? id;
  const order = topoOrder(g.nodes.map((n) => n.id), g.connections, nameOf);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  // Group incoming connections by target, so each node's line can pull just its
  // own without a full-array scan per node.
  const incoming = new Map<string, SavedConnection[]>();
  for (const c of g.connections) {
    const arr = incoming.get(c.target);
    if (arr) arr.push(c);
    else incoming.set(c.target, [c]);
  }

  const lines: string[] = [];
  for (const id of order) {
    const sn = byId.get(id);
    if (!sn) continue;
    const name = nameOf(id);
    const parts = [`${name}:`, sn.type];

    const init: Record<string, unknown> = { ...sn.init };
    if (typeof init.hostNodeId === "string") init.hostNodeId = nameOf(init.hostNodeId);
    if (Array.isArray(init.members)) init.members = (init.members as unknown[]).map((m) => (typeof m === "string" ? nameOf(m) : m));
    // Presentation steps each reference a node-id SET (the camera target). Like
    // members, these are live ids on the instance — translate them to names so
    // they stay addressable across a reload (rebuildGraph maps names back to fresh
    // ids). Without this the steps survive but point at dead ids after reload.
    if (Array.isArray(init.steps)) {
      init.steps = (init.steps as Array<{ nodeIds?: unknown }>).map((s) => ({
        ...s,
        nodeIds: Array.isArray(s.nodeIds)
          ? (s.nodeIds as unknown[]).map((m) => (typeof m === "string" ? nameOf(m) : m))
          : s.nodeIds,
      }));
    }
    for (const [k, v] of canonicalEntries(init)) parts.push(`${k}=${JSON.stringify(v)}`);

    for (const k of Object.keys(sn.literals ?? {}).sort()) {
      parts.push(`lit:${k}=${JSON.stringify(sn.literals![k])}`);
    }
    for (const k of Object.keys(sn.stringLiterals ?? {}).sort()) {
      parts.push(`str:${k}=${JSON.stringify(sn.stringLiterals![k])}`);
    }

    const conns = [...(incoming.get(id) ?? [])].sort((a, b) => (a.targetInput < b.targetInput ? -1 : a.targetInput > b.targetInput ? 1 : 0));
    for (const c of conns) {
      parts.push(`${c.targetInput}<-${nameOf(c.source)}.${outputToken(c.sourceOutput)}`);
    }

    lines.push(parts.join(" "));
  }

  const positions: Record<string, { x: number; y: number; size?: { w: number; h: number }; collapsed?: boolean }> = {};
  for (const id of order) {
    const sn = byId.get(id);
    if (!sn) continue;
    const p: { x: number; y: number; size?: { w: number; h: number }; collapsed?: boolean } = { x: sn.x, y: sn.y };
    if (sn.size) p.size = { w: sn.size.w, h: sn.size.h };
    if (sn.collapsed) p.collapsed = true;
    positions[nameOf(id)] = p;
  }

  const sidecar: Record<string, unknown> = { v: g.v, positions };
  if (g.standoffs && g.standoffs.length > 0) {
    sidecar.standoffs = g.standoffs.map((s) => ({
      a: { nodeId: nameOf(s.a.nodeId), anchor: s.a.anchor },
      b: { nodeId: nameOf(s.b.nodeId), anchor: s.b.anchor },
      min: s.min,
      max: s.max,
      ...(s.locked ? { locked: true } : {}),
    }));
  }
  if (g.pins && g.pins.length > 0) {
    sidecar.pins = g.pins.map((p) => ({ nodeId: nameOf(p.nodeId), outputKey: p.outputKey }));
  }
  if (g.comments && g.comments.length > 0) {
    // Node-anchored, so name-address the nodeId like pins/standoffs (names ARE ids
    // on read). The comment's own `id` is not a node reference — kept as-is.
    sidecar.comments = g.comments.map((c) => ({ ...c, nodeId: nameOf(c.nodeId) }));
  }
  if (g.frameFormats && g.frameFormats.length > 0) {
    // Per-column frame formats — name-address the nodeId like comments/pins.
    sidecar.frameFormats = g.frameFormats.map((f) => ({ ...f, nodeId: nameOf(f.nodeId) }));
  }
  if (g.seedId !== undefined) sidecar.seedId = g.seedId;
  if (g.palette !== undefined) sidecar.palette = g.palette;
  if (g.reportPalette !== undefined) sidecar.reportPalette = g.reportPalette;
  if (g.meta !== undefined) sidecar.meta = g.meta;
  if (g.packs && g.packs.length > 0) sidecar.packs = g.packs;

  const header = lines.length > 0 ? lines.join("\n") + "\n" : "";
  return `${header}${SEPARATOR}\n${JSON.stringify(sidecar, null, 2)}\n`;
}

// ─── Reader ──────────────────────────────────────────────────────────────────────

export function readTextForm(text: string): SavedGraph {
  const allLines = text.split("\n");
  const sepIdx = allLines.indexOf(SEPARATOR);
  if (sepIdx === -1) throw new Error('textForm: missing "---" separator line');
  const nodeLines = allLines.slice(0, sepIdx).filter((l) => l.length > 0);
  const sidecarText = allLines.slice(sepIdx + 1).join("\n");
  const sidecar = sidecarText.trim().length > 0 ? JSON.parse(sidecarText) : {};

  type Parsed = {
    name: string;
    type: string;
    init: Record<string, unknown>;
    literals: Record<string, number>;
    stringLiterals: Record<string, string>;
    conns: Array<{ targetInput: string; sourceName: string; sourceOutput: string }>;
  };
  const parsed: Parsed[] = nodeLines.map((line) => parseNodeLine(line));

  const names = new Set<string>();
  for (const p of parsed) {
    if (names.has(p.name)) throw new Error(`textForm: duplicate node name "${p.name}"`);
    names.add(p.name);
  }

  // Names ARE the ids in the reconstructed SavedGraph — rete's rebuildGraph
  // remaps every saved id to a fresh live id on load regardless of its shape
  // (idMap), so there's no reason to invent a second opaque id alongside the
  // name; using the name directly keeps the JSON generated from this text form
  // just as addressable as the text itself.
  // `hostNodeId`/`members` inside `init` are already names (the writer translated
  // them) — and names ARE ids here, so no further translation is needed on read.
  const nodes: SavedNode[] = parsed.map((p) => {
    const pos = (sidecar.positions?.[p.name] ?? { x: 0, y: 0 }) as { x: number; y: number; size?: { w: number; h: number }; collapsed?: boolean };
    const sn: SavedNode = {
      id: p.name,
      type: p.type,
      name: p.name,
      x: pos.x ?? 0,
      y: pos.y ?? 0,
      init: p.init,
    };
    if (Object.keys(p.literals).length > 0) sn.literals = p.literals;
    if (Object.keys(p.stringLiterals).length > 0) sn.stringLiterals = p.stringLiterals;
    if (pos.size) sn.size = pos.size;
    if (pos.collapsed) sn.collapsed = true;
    return sn;
  });

  const connections: SavedConnection[] = [];
  for (const p of parsed) {
    for (const c of p.conns) {
      connections.push({ source: c.sourceName, sourceOutput: c.sourceOutput, target: p.name, targetInput: c.targetInput });
    }
  }

  const g: SavedGraph = { v: typeof sidecar.v === "number" ? sidecar.v : 2, nodes, connections };
  if (Array.isArray(sidecar.standoffs) && sidecar.standoffs.length > 0) {
    g.standoffs = sidecar.standoffs as SavedStandoff[];
  }
  if (Array.isArray(sidecar.pins) && sidecar.pins.length > 0) {
    g.pins = sidecar.pins as Pin[];
  }
  if (Array.isArray(sidecar.comments) && sidecar.comments.length > 0) {
    g.comments = sidecar.comments as SavedGraph["comments"];
  }
  if (Array.isArray(sidecar.frameFormats) && sidecar.frameFormats.length > 0) {
    g.frameFormats = sidecar.frameFormats as SavedGraph["frameFormats"];
  }
  if (sidecar.seedId !== undefined) g.seedId = sidecar.seedId;
  if (sidecar.palette !== undefined) g.palette = sidecar.palette;
  if (sidecar.reportPalette !== undefined) g.reportPalette = sidecar.reportPalette;
  if (sidecar.meta !== undefined) g.meta = sidecar.meta as SavedGraph["meta"];
  if (Array.isArray(sidecar.packs) && sidecar.packs.length > 0) g.packs = sidecar.packs;

  return g;
}

export function parseNodeLine(line: string): {
  name: string;
  type: string;
  init: Record<string, unknown>;
  literals: Record<string, number>;
  stringLiterals: Record<string, string>;
  conns: Array<{ targetInput: string; sourceName: string; sourceOutput: string }>;
} {
  const colonIdx = line.indexOf(": ");
  if (colonIdx === -1) throw new Error(`textForm: malformed node line "${line}"`);
  const name = line.slice(0, colonIdx);
  const rest = line.slice(colonIdx + 2);
  const spaceIdx = rest.indexOf(" ");
  const type = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const fieldsStr = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1);

  const init: Record<string, unknown> = {};
  const literals: Record<string, number> = {};
  const stringLiterals: Record<string, string> = {};
  const conns: Array<{ targetInput: string; sourceName: string; sourceOutput: string }> = [];

  for (const token of tokenizeFields(fieldsStr)) {
    const { key, op, rest: valueStr } = splitField(token);
    if (op === "<-") {
      const dotIdx = valueStr.indexOf(".");
      if (dotIdx === -1) throw new Error(`textForm: malformed connection "${token}"`);
      const outRaw = valueStr.slice(dotIdx + 1);
      // A JSON-quoted output key (see outputToken) decodes; bare passes through.
      const sourceOutput = outRaw.startsWith('"') ? (JSON.parse(outRaw) as string) : outRaw;
      conns.push({ targetInput: key, sourceName: valueStr.slice(0, dotIdx), sourceOutput });
    } else if (key.startsWith("lit:")) {
      literals[key.slice(4)] = JSON.parse(valueStr) as number;
    } else if (key.startsWith("str:")) {
      stringLiterals[key.slice(4)] = JSON.parse(valueStr) as string;
    } else {
      init[key] = JSON.parse(valueStr);
    }
  }

  return { name, type, init, literals, stringLiterals, conns };
}
