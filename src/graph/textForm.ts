// [[B12]] losslessSaves, [[B16]] oneFormulaSurface
// The text form a save passes through (`crates/solenoid-graph/src/text_form.rs`): the core writes and reads it; the
// node names and the init field order are the app's.
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

/** The text a save passes through, written on the core (`text_form.rs`); the names are given here. */
export function writeTextForm(g: SavedGraph): string {
  const idToName = assignNames(g.nodes);
  return textFormWrite(JSON.stringify(g), JSON.stringify(g.nodes.map((n) => idToName.get(n.id))), FIELD_ORDER);
}

function fromCore(r: string): string {
  if (r.startsWith("!")) throw new Error(r.slice(1));
  return r;
}

/** The save a text holds, read on the core (`text_form.rs`). */
export function readTextForm(text: string): SavedGraph {
  return JSON.parse(fromCore(textFormRead(text, CURRENT_SAVE_VERSION))) as SavedGraph;
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
