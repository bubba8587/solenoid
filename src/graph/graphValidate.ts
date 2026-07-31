// The STRICT validating reader over the text form / saved graph — the gate an
// AI (or any programmatic author) runs BEFORE a generated graph touches a
// document (backlog "AI command palette", D27). The permissive load path is
// deliberately forgiving — an unknown type becomes a Placeholder, a refused
// cable is silently dropped in rebuildGraph, an unknown init key is ignored —
// which is right for a human reopening their own save and fatal for a
// generate→apply loop, where garbage would apply "successfully" and the author
// never learns it erred. This module reports every such would-be-silent repair
// as an issue with a message precise enough to fix the text from ("no input
// `vals` on AggregateNode — nearest `values`"), and flags exactly what the live
// editor would refuse (`canConnect`, the same directional check the connection
// guard runs).
//
// Pure + headless (no rete editor, no DOM) in the persistenceCore/textForm
// mold: node classes are instantiated once each via the SAME registry
// persistence rebuilds from (`ctorRegistry`), and their declared sockets are
// introspected off the instance. A node whose sockets only materialize later
// (e.g. a Composite hydrating its saved ports) reports an EMPTY socket record —
// key checks are skipped for that side rather than false-positived.

import type { SavedGraph, SavedNode } from "./persistence";
import { readTextForm, parseNodeLine } from "./textForm";
import { ctorRegistry } from "./nodeCtorRegistry";
import { INIT_FIELD_ORDER, INIT_EXTRA_FIELD_ORDER } from "./copyPaste";
import { NAME_RE } from "./nodeNaming";
import {
  canConnect, SolenoidSocket, elementFamilyOf, latticeRank,
  type SocketDataType,
} from "./sockets";
import { CURRENT_SAVE_VERSION } from "./persistenceCore";

export interface GraphIssue {
  /** 1-based line in the text form; null for sidecar/whole-graph issues (and
   *  for graphs validated straight from JSON, which has no line numbers). */
  line: number | null;
  /** The node the issue anchors to (its name), when there is one. */
  node: string | null;
  message: string;
  /** "warning" for states that are LEGAL to load and run (a dependency cycle
   *  computes as #CIRC! — the null-and-logical seed ships one on purpose) but
   *  almost certainly unintended in a generated graph. Errors (the default)
   *  are conditions the loader would silently repair or the editor refuse. */
  severity?: "warning";
}

// ─── Nearest-name suggestions ───────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** " — nearest: `x`, `y`" for the closest candidates within an edit-distance
 *  budget that scales with the key's length; "" when nothing is close. */
function nearest(key: string, candidates: Iterable<string>): string {
  const budget = Math.max(2, Math.ceil(key.length / 4));
  const lower = key.toLowerCase();
  const scored: Array<{ c: string; d: number }> = [];
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d <= budget) scored.push({ c, d });
  }
  scored.sort((a, b) => a.d - b.d);
  const best = scored.slice(0, 2).map((s) => `\`${s.c}\``);
  return best.length > 0 ? ` — nearest: ${best.join(", ")}` : "";
}

function keyList(keys: string[]): string {
  const shown = keys.slice(0, 10);
  return shown.join(", ") + (keys.length > shown.length ? ", …" : "");
}

// ─── Socket introspection off a headless instance ───────────────────────────────

interface PortMap { [key: string]: { dataType: SocketDataType | null; multiple: boolean } }

function portsOf(record: Record<string, unknown> | undefined): PortMap {
  const out: PortMap = {};
  for (const [k, port] of Object.entries(record ?? {})) {
    if (!port || typeof port !== "object") continue;
    const p = port as { socket?: unknown; multipleConnections?: unknown };
    const dataType = p.socket instanceof SolenoidSocket ? p.socket.dataType : null;
    out[k] = { dataType, multiple: p.multipleConnections === true };
  }
  return out;
}

/** Why `canConnect` says no, phrased as the fix. */
function refusalReason(outT: SocketDataType, inT: SocketDataType): string {
  const of = elementFamilyOf(outT), inf = elementFamilyOf(inT);
  if (of && inf && of !== inf) {
    return `element families never auto-cross — insert a Cast node (the sole bridge is logical↔number)`;
  }
  const or = latticeRank(outT), ir = latticeRank(inT);
  if (or !== null && ir !== null && or > ir) {
    return `a wider value never narrows into a smaller input — reshape explicitly (Get Column / a list op) first`;
  }
  return `the socket lattice refuses it (canConnect)`;
}

// ─── The semantic pass ──────────────────────────────────────────────────────────

const INIT_KEY_SET = new Set<string>([...INIT_FIELD_ORDER, ...INIT_EXTRA_FIELD_ORDER]);

/**
 * Validate a SavedGraph the way the STRICT reader needs it validated: every
 * silently-repaired-on-load condition is an issue. `lineOf` maps a node's
 * name to its 1-based text-form line for anchored messages (absent for JSON).
 */
export function validateGraph(g: SavedGraph, lineOf?: (name: string) => number | null): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const registry = ctorRegistry();
  const at = (name: string | null): number | null => (name && lineOf ? lineOf(name) : null);
  const displayName = (sn: SavedNode): string => sn.name ?? sn.id;

  if (typeof g.v === "number" && g.v > CURRENT_SAVE_VERSION) {
    issues.push({ line: null, node: null, message: `save version ${g.v} is newer than this build's ${CURRENT_SAVE_VERSION} — the loader will refuse the file.` });
  }

  // One headless instance per node (each node's init can change its socket set,
  // so a per-class cache would lie for op-selected and row-driven sockets).
  const instances = new Map<string, { inputs: PortMap; outputs: PortMap; hasLiterals: boolean; hasStringLiterals: boolean } | null>();
  const byId = new Map<string, SavedNode>();

  for (const sn of g.nodes) {
    const name = displayName(sn);
    byId.set(sn.id, sn);

    if (typeof sn.name === "string" && !NAME_RE.test(sn.name)) {
      issues.push({ line: at(name), node: name, message: `node name "${sn.name}" is not a valid identifier (letters/digits/underscore, not starting with a digit).` });
    }

    const Ctor = registry.get(sn.type);
    if (!Ctor) {
      issues.push({ line: at(name), node: name, message: `unknown node type "${sn.type}"${nearest(sn.type, registry.keys())} — the permissive loader would keep it only as a Placeholder. Types are class names (\`npm run ai-grounding\` lists them all).` });
      instances.set(sn.id, null);
      continue;
    }

    let inst: InstanceType<typeof Ctor>;
    try {
      inst = new Ctor({ ...sn.init });
    } catch (e) {
      issues.push({ line: at(name), node: name, message: `constructing ${sn.type} with this init threw: ${e instanceof Error ? e.message : String(e)}.` });
      instances.set(sn.id, null);
      continue;
    }
    const anyInst = inst as unknown as Record<string, unknown>;

    // Init keys: every key extractInit can emit comes FROM the instance — the
    // global whitelist, a spread of the class's `literals`/`stringLiterals`
    // defaults (Slider min/max/step), an extensible node's row keys
    // (`valueKeys` → per-row inputs), or a composite capability (`internal`).
    // So judge against the constructed instance, not the static list alone.
    const litKeys = Object.keys((anyInst.literals as object) ?? {});
    const strKeys = Object.keys((anyInst.stringLiterals as object) ?? {});
    const inputKeys = Object.keys((anyInst.inputs as object) ?? {});
    const initOk = (k: string): boolean =>
      INIT_KEY_SET.has(k) || k in anyInst || litKeys.includes(k) || strKeys.includes(k) || inputKeys.includes(k) ||
      (k === "valueKeys" && (typeof anyInst.addValueInput === "function" || typeof anyInst.addValuePair === "function")) ||
      (k === "internal" && typeof anyInst.snapshotInternal === "function");
    for (const k of Object.keys(sn.init ?? {})) {
      if (!initOk(k)) {
        const candidates = new Set<string>([...INIT_KEY_SET, ...litKeys, ...strKeys]);
        issues.push({ line: at(name), node: name, message: `unknown init field "${k}"${nearest(k, candidates)} — ${sn.type} carries no such field, so this value would be silently ignored.` });
      }
    }
    const info = {
      inputs: portsOf(anyInst.inputs as Record<string, unknown> | undefined),
      outputs: portsOf(anyInst.outputs as Record<string, unknown> | undefined),
      // The same declaration gate persistence.ts restores through: a class
      // takes inline literals iff it declares the map.
      hasLiterals: typeof anyInst.literals === "object" && anyInst.literals !== null,
      hasStringLiterals: typeof anyInst.stringLiterals === "object" && anyInst.stringLiterals !== null,
    };
    instances.set(sn.id, info);

    for (const k of Object.keys(sn.literals ?? {})) {
      if (!info.hasLiterals) {
        issues.push({ line: at(name), node: name, message: `lit:${k} — ${sn.type} takes no inline numeric literals (it declares no \`literals\` map), so the loader would silently drop this value.` });
      } else if (typeof sn.literals![k] !== "number") {
        issues.push({ line: at(name), node: name, message: `lit:${k} must be a number (got ${JSON.stringify(sn.literals![k])}) — non-numeric inline values use str:.` });
      }
    }
    for (const k of Object.keys(sn.stringLiterals ?? {})) {
      if (!info.hasStringLiterals) {
        issues.push({ line: at(name), node: name, message: `str:${k} — ${sn.type} takes no inline text literals (it declares no \`stringLiterals\` map), so the loader would silently drop this value.` });
      } else if (typeof sn.stringLiterals![k] !== "string") {
        issues.push({ line: at(name), node: name, message: `str:${k} must be a string (got ${JSON.stringify(sn.stringLiterals![k])}).` });
      }
    }
  }

  // Connections. rebuildGraph would DROP every refused one without a word —
  // each is an issue here.
  const wiredCount = new Map<string, number>(); // "targetId\u0000input" → cables in
  for (const c of g.connections) {
    const tgt = byId.get(c.target);
    const src = byId.get(c.source);
    const tgtName = tgt ? displayName(tgt) : c.target;

    if (!tgt) {
      issues.push({ line: null, node: null, message: `connection into unknown node "${c.target}"${nearest(c.target, [...byId.values()].map(displayName))}.` });
      continue;
    }
    if (!src) {
      issues.push({ line: at(tgtName), node: tgtName, message: `input "${c.targetInput}" wires from unknown node "${c.source}"${nearest(c.source, [...byId.values()].map(displayName))}.` });
      continue;
    }
    const srcName = displayName(src);
    const tgtInfo = instances.get(tgt.id);
    const srcInfo = instances.get(src.id);

    let inPort: PortMap[string] | undefined;
    if (tgtInfo && Object.keys(tgtInfo.inputs).length > 0) {
      inPort = tgtInfo.inputs[c.targetInput];
      if (!inPort) {
        issues.push({ line: at(tgtName), node: tgtName, message: `no input "${c.targetInput}" on ${tgt.type}${nearest(c.targetInput, Object.keys(tgtInfo.inputs))}. Inputs: ${keyList(Object.keys(tgtInfo.inputs))}.` });
      }
    }
    let outPort: PortMap[string] | undefined;
    if (srcInfo && Object.keys(srcInfo.outputs).length > 0) {
      outPort = srcInfo.outputs[c.sourceOutput];
      if (!outPort) {
        issues.push({ line: at(tgtName), node: tgtName, message: `input "${c.targetInput}" wires from ${srcName}.${c.sourceOutput}, but ${src.type} has no output "${c.sourceOutput}"${nearest(c.sourceOutput, Object.keys(srcInfo.outputs))}. Outputs: ${keyList(Object.keys(srcInfo.outputs))}.` });
      }
    }

    if (inPort?.dataType && outPort?.dataType && !canConnect(outPort.dataType, inPort.dataType)) {
      issues.push({ line: at(tgtName), node: tgtName, message: `${srcName}.${c.sourceOutput} (${outPort.dataType}) can't feed "${c.targetInput}" (${inPort.dataType}): ${refusalReason(outPort.dataType, inPort.dataType)}. The live editor refuses this cable; the loader would drop it silently.` });
    }

    if (inPort) {
      const key = `${tgt.id}\u0000${c.targetInput}`;
      const n = (wiredCount.get(key) ?? 0) + 1;
      wiredCount.set(key, n);
      if (n === 2 && !inPort.multiple) {
        issues.push({ line: at(tgtName), node: tgtName, message: `input "${c.targetInput}" is wired more than once but accepts a single cable.` });
      }
    }
  }

  // Dependency cycles compute as #CIRC! at runtime — a generated graph almost
  // certainly didn't mean to close one, so surface it.
  const cycleNames = findCycle(g);
  if (cycleNames) {
    issues.push({ line: null, node: null, severity: "warning", message: `dependency cycle: ${cycleNames.join(" → ")} — these nodes will compute as #CIRC!.` });
  }

  return issues;
}

function findCycle(g: SavedGraph): string[] | null {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const nameOf = new Map<string, string>();
  for (const n of g.nodes) { indeg.set(n.id, 0); nameOf.set(n.id, n.name ?? n.id); }
  for (const c of g.connections) {
    if (!indeg.has(c.source) || !indeg.has(c.target)) continue;
    indeg.set(c.target, (indeg.get(c.target) ?? 0) + 1);
    (adj.get(c.source) ?? adj.set(c.source, []).get(c.source)!).push(c.target);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let removed = 0;
  while (queue.length > 0) {
    const id = queue.pop()!;
    removed++;
    for (const t of adj.get(id) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0) queue.push(t);
    }
  }
  if (removed === g.nodes.length) return null;
  const leftover = [...indeg.entries()].filter(([, d]) => d > 0).map(([id]) => nameOf.get(id) ?? id);
  return leftover.sort();
}

// ─── The text-form pass (grammar + semantics, all issues in one report) ─────────

export interface TextValidation {
  issues: GraphIssue[];
  /** The parsed graph — from the real reader when the grammar is clean, from
   *  the per-line salvage when it isn't (so semantic issues still report). Null
   *  only when nothing parsed at all. */
  graph: SavedGraph | null;
}

/**
 * Validate a text-form document end to end: per-line grammar (reporting EVERY
 * malformed line, not just the first), the sidecar JSON, then the full
 * semantic pass with line-anchored messages.
 */
export function validateText(text: string): TextValidation {
  const issues: GraphIssue[] = [];
  const allLines = text.split("\n");
  const sepIdx = allLines.indexOf("---");
  if (sepIdx === -1) {
    issues.push({ line: null, node: null, message: `missing the "---" separator line — the sidecar JSON block after it is required (an empty graph's sidecar is just {}).` });
  }
  const nodeLineEnd = sepIdx === -1 ? allLines.length : sepIdx;

  type Parsed = ReturnType<typeof parseNodeLine> & { line: number };
  const parsed: Parsed[] = [];
  let grammarClean = sepIdx !== -1;
  for (let i = 0; i < nodeLineEnd; i++) {
    const line = allLines[i];
    if (line.length === 0) continue;
    try {
      parsed.push({ ...parseNodeLine(line), line: i + 1 });
    } catch (e) {
      grammarClean = false;
      issues.push({ line: i + 1, node: null, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const lineByName = new Map<string, number>();
  for (const p of parsed) {
    if (lineByName.has(p.name)) {
      grammarClean = false;
      issues.push({ line: p.line, node: p.name, message: `duplicate node name "${p.name}" (first used on line ${lineByName.get(p.name)}).` });
    } else {
      lineByName.set(p.name, p.line);
    }
  }

  let sidecar: Record<string, unknown> = {};
  if (sepIdx !== -1) {
    const sidecarText = allLines.slice(sepIdx + 1).join("\n").trim();
    if (sidecarText.length > 0) {
      try {
        sidecar = JSON.parse(sidecarText) as Record<string, unknown>;
      } catch (e) {
        grammarClean = false;
        issues.push({ line: sepIdx + 2, node: null, message: `sidecar is not valid JSON: ${e instanceof Error ? e.message : String(e)}.` });
      }
    }
  }

  // Assemble the graph: the real reader when it can't disagree with us, a
  // salvage of the cleanly-parsed lines otherwise (duplicate names keep the
  // first — matching a map's insert-once).
  let graph: SavedGraph | null = null;
  if (grammarClean) {
    graph = readTextForm(text);
  } else if (parsed.length > 0) {
    const seen = new Set<string>();
    const salvage = parsed.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
    graph = {
      v: typeof sidecar.v === "number" ? sidecar.v : CURRENT_SAVE_VERSION,
      nodes: salvage.map((p) => {
        const sn: SavedNode = { id: p.name, type: p.type, name: p.name, x: 0, y: 0, init: p.init };
        if (Object.keys(p.literals).length > 0) sn.literals = p.literals;
        if (Object.keys(p.stringLiterals).length > 0) sn.stringLiterals = p.stringLiterals;
        return sn;
      }),
      connections: salvage.flatMap((p) =>
        p.conns.map((c) => ({ source: c.sourceName, sourceOutput: c.sourceOutput, target: p.name, targetInput: c.targetInput })),
      ),
    };
  }

  if (graph) {
    issues.push(...validateGraph(graph, (name) => lineByName.get(name) ?? null));

    // Sidecar references are name-addressed — a typo here silently loses the
    // position/standoff/pin/comment on load.
    const names = new Set(graph.nodes.map((n) => n.name ?? n.id));
    const refIssue = (section: string, name: unknown) => {
      if (typeof name === "string" && !names.has(name)) {
        issues.push({ line: null, node: null, message: `sidecar ${section} references unknown node "${name}"${nearest(name, names)}.` });
      }
    };
    for (const k of Object.keys((sidecar.positions as Record<string, unknown>) ?? {})) refIssue("positions", k);
    for (const s of (sidecar.standoffs as Array<{ a?: { nodeId?: unknown }; b?: { nodeId?: unknown } }>) ?? []) {
      refIssue("standoffs", s?.a?.nodeId);
      refIssue("standoffs", s?.b?.nodeId);
    }
    for (const p of (sidecar.pins as Array<{ nodeId?: unknown }>) ?? []) refIssue("pins", p?.nodeId);
    for (const c of (sidecar.comments as Array<{ nodeId?: unknown }>) ?? []) refIssue("comments", c?.nodeId);
    for (const f of (sidecar.frameFormats as Array<{ nodeId?: unknown }>) ?? []) refIssue("frameFormats", f?.nodeId);
  }

  return { issues, graph };
}

/** The issues that make a graph unsafe to apply — warnings excluded. */
export function hardIssues(issues: GraphIssue[]): GraphIssue[] {
  return issues.filter((i) => i.severity !== "warning");
}

/** One issue per line, `line N: message`-shaped, ready for a CLI or a model. */
export function formatIssues(issues: GraphIssue[]): string {
  return issues
    .map((i) => {
      const where = i.line !== null ? `line ${i.line}` : "graph";
      const who = i.node ? ` [${i.node}]` : "";
      const sev = i.severity === "warning" ? "warning: " : "";
      return `${where}${who}: ${sev}${i.message}`;
    })
    .join("\n");
}
