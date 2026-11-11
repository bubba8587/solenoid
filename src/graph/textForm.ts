// [[B12]] losslessSaves, [[B16]] oneFormulaSurface
// The text form a save passes through (`crates/solenoid-graph/src/text_form.rs`): the core writes and reads it; the
// node names and the init field order are the app's.
import { withImpliedRows } from "./textFormRows";
import type { SavedGraph, SavedNode } from "./persistence";
import { CURRENT_SAVE_VERSION } from "./persistenceCore";
import { INIT_FIELD_ORDER, INIT_EXTRA_FIELD_ORDER } from "./nodeInit";
import { NAME_RE, typePrefix, nextAvailableName } from "./nodeNaming";
import { textFormWrite, textFormRead, textFormLine } from "./engineWasm/solenoid_graph.js";

/** Each node's name in the text: its own where it is a free identifier, else the next free `Type_n`. */
export function assignNames(nodes: SavedNode[]): Map<string, string> {
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

const FIELD_ORDER = JSON.stringify([...INIT_FIELD_ORDER, ...INIT_EXTRA_FIELD_ORDER]);

// JSON.stringify spells half a surrogate pair as `\udXXX`, which the core's JSON (Rust text) can't hold: it becomes U+FFFD.
const LONE_SURROGATE = /(?<!\\)((?:\\\\)*)\\ud[89a-f][0-9a-f]{2}/g;

/** The text a save passes through, written on the core (`text_form.rs`); the names are given here. */
export function writeTextForm(g: SavedGraph): string {
  const idToName = assignNames(g.nodes);
  const json = JSON.stringify(g).replace(LONE_SURROGATE, "$1\\ufffd");
  return fromCore(textFormWrite(json, JSON.stringify(g.nodes.map((n) => idToName.get(n.id))), FIELD_ORDER));
}

function fromCore(r: string): string {
  if (r.startsWith("!")) throw new Error(r.slice(1));
  return r;
}

type CardMark = NonNullable<SavedNode["foreign"]>;

/** Both marks' asks: a mark only ever gains what it asks, never loses it to a rewrite's own say. */
function joinMarks(a: CardMark | undefined, b: CardMark | undefined): CardMark {
  return {
    ...(a?.scripts === true || b?.scripts === true ? { scripts: true as const } : {}),
    ...(a?.network === true || b?.network === true ? { network: true as const } : {}),
    ...(a?.elsewhere === true || b?.elsewhere === true ? { elsewhere: true as const } : {}),
  };
}

/** `next` (a rewrite read back from text) with each card someone else wrote still marked ([[B18]] safeToShare): a
 *  rewrite never clears what a card still asks. Cards match by the name the text form gives them; where a marked
 *  name is gone (the rewrite renamed it), every card of that type not named as one of the user's own asks too. */
export function keepCardTrust(current: SavedGraph, next: SavedGraph): SavedGraph {
  const idToName = assignNames(current.nodes);
  const marks = new Map<string, CardMark>();
  const byType = new Map<string, CardMark>();
  const own = new Set<string>();
  for (const n of current.nodes) {
    const name = idToName.get(n.id) ?? n.id;
    if (n.foreign && (n.foreign.scripts || n.foreign.network || n.foreign.elsewhere)) {
      marks.set(name, n.foreign);
      byType.set(n.type, joinMarks(byType.get(n.type), n.foreign));
    } else own.add(name);
  }
  if (marks.size === 0) return next;
  const names = new Set(next.nodes.map((n) => n.name ?? n.id));
  const lost = [...marks.keys()].some((k) => !names.has(k));
  return { ...next, nodes: next.nodes.map((n) => {
    const name = n.name ?? n.id;
    const m = marks.get(name) ?? (lost && !own.has(name) ? byType.get(n.type) : undefined);
    return m ? { ...n, foreign: joinMarks(n.foreign, m) } : n;
  }) };
}

/** The save a text holds, read on the core (`text_form.rs`). */
/** The graph a text form holds; a row a line names without `valueKeys` is built (`textFormRows.ts`). */
export function readTextForm(text: string): SavedGraph {
  return withImpliedRows(JSON.parse(fromCore(textFormRead(text, CURRENT_SAVE_VERSION))) as SavedGraph);
}

/** One node line, read on the core. */
export function parseNodeLine(line: string): {
  name: string;
  type: string;
  init: Record<string, unknown>;
  literals: Record<string, number>;
  stringLiterals: Record<string, string>;
  hasLiterals: boolean;
  hasStringLiterals: boolean;
  conns: Array<{ targetInput: string; sourceName: string; sourceOutput: string }>;
} {
  const l = JSON.parse(fromCore(textFormLine(line))) as {
    name: string; type: string; init: Record<string, unknown>;
    literals?: Record<string, number>; stringLiterals?: Record<string, string>; conns: [string, string, string][];
  };
  return {
    name: l.name, type: l.type, init: l.init,
    literals: l.literals ?? {}, stringLiterals: l.stringLiterals ?? {},
    hasLiterals: l.literals !== undefined, hasStringLiterals: l.stringLiterals !== undefined,
    conns: l.conns.map(([targetInput, sourceName, sourceOutput]) => ({ targetInput, sourceName, sourceOutput })),
  };
}
