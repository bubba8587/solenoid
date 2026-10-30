// [[C130]] rustCore, [[D99]] rustIsSpec, [[B12]] losslessSaves
// The text form's frozen answers (fixtures/core/text-form.json.gz): every seed graph written to text and read back,
// and hand-written texts read, well-formed and not. Valid JSON, not JavaScript's spelling of it: a number keeps its
// sign and digits, an object the order its keys were written in. Compared as text, since a save's key order is part of it; the Rust
// is held to the same answers natively (`crates/solenoid-graph/tests/text_form.rs`).
import { describe, expect, it } from "vitest";
import { frozen } from "./coreFixtures";
import { SEEDS } from "../../src/graph/seeds";
import { writeTextForm, assignNames } from "../../src/graph/textForm";
import { textFormRead } from "../../src/graph/engineWasm/solenoid_graph.js";
import { CURRENT_SAVE_VERSION } from "../../src/graph/persistenceCore";
import type { SavedGraph } from "../../src/graph/persistence";
import { INIT_FIELD_ORDER, INIT_EXTRA_FIELD_ORDER } from "../../src/graph/nodeInit";

type Case = { kind: "order"; order: string[]; want?: undefined } | { kind: "write"; graph: string; input: string; names: string[]; want?: string } | { kind: "read"; text: string; want?: string };

/** A write case: the save as JSON and its nodes' names, with the text it writes. */
const writeCase = (graph: string, g: SavedGraph): Case => {
  const names = assignNames(g.nodes);
  return { kind: "write", graph, input: JSON.stringify(g), names: g.nodes.map((n) => names.get(n.id)!), want: writeTextForm(g) };
};

/** The save the core reads from a text, as the JSON text it answers (or `!` and why not). */
const read = (text: string): string => textFormRead(text, CURRENT_SAVE_VERSION);

const SIDECAR = '---\n{ "v": 2, "positions": { "B": { "x": 5, "y": 6 }, "A": { "x": 1, "y": 2, "size": { "w": 3, "h": 4 }, "collapsed": true } } }\n';
const TEXTS = [
  `A: ValueInputNode label="x" value="5" lit:{} str:{}\nB: DisplayNode in<-A.value\n${SIDECAR}`,
  `A: MathFnNode op="abs" lit:x=1.5 lit:"rate.annual"=2 str:"{{ a-b }}"="hi there" "λ1"=3\n---\n{}`,
  `B: DisplayNode "my in"<-A."out put"\nA: ValueInputNode\n${SIDECAR}`,
  `A: ValueInputNode\n---\n{ "v": 1, "positions": { "A": { "x": 1.25, "y": -0 } }, "pins": [{ "nodeId": "A", "outputKey": "value" }], "savedAt": 1700000000000, "packs": ["finance"], "meta": { "tags": ["a"] }, "palette": { "base": "x" }, "standoffs": [], "comments": [{ "nodeId": "A", "text": "c" }] }`,
  `A: ValueInputNode\nA: DisplayNode\n---\n{}`,
  `A ValueInputNode\n---\n{}`,
  `A: ValueInputNode bad\n---\n{}`,
  `A: ValueInputNode "unterminated=1\n---\n{}`,
  `A: ValueInputNode lit:"k"<-B.out\n---\n{}`,
  `B: DisplayNode in<-Aout\n---\n{}`,
  `A: ValueInputNode`,
  `\n\nA: ValueInputNode   label="two  spaces"\n\n---\n\n`,
  `A: ValueInputNode label="esc \\" quote" n=1e21 m=-0 f=0.1 big=12345678901234567890 neg=-1.5e-7 arr=[1,"x",null,true,{"z":1,"a":2}] obj={"2":"b","1":"a","x":"c"}\n---\n{ "positions": { "A": { "x": 0, "y": 0 } } }`,
  `Z: ValueInputNode\nA: ValueInputNode\n---\n{ "positions": { "A": { "x": 0, "y": 0 } } }`,
];

describe("the text form holds to its frozen answers", () => {
  it("every seed written and read back, and hand-written texts read", () => {
    const fresh: Case[] = [{ kind: "order", order: [...INIT_FIELD_ORDER, ...INIT_EXTRA_FIELD_ORDER] }];
    for (const [id, seed] of Object.entries(SEEDS) as [string, { graph: SavedGraph }][]) {
      const w = writeCase(id, seed.graph);
      fresh.push(w, { kind: "read", text: w.want!, want: read(w.want!) });
    }
    for (const text of TEXTS) {
      fresh.push({ kind: "read", text, want: read(text) });
      const g = read(text);
      if (!g.startsWith("!")) fresh.push(writeCase(`text:${text.slice(0, 30)}`, JSON.parse(g) as SavedGraph));
    }
    const cases = frozen<Case>("text-form", () => fresh);
    expect(cases.length).toBe(fresh.length);
    const bad = cases.filter((c, i) => (c.kind === "order" ? JSON.stringify(c.order) !== JSON.stringify((fresh[i] as { order?: string[] }).order) : c.want !== fresh[i].want)).map((c) => (c.kind === "write" ? c.graph : c.kind === "read" ? c.text.slice(0, 40) : "order"));
    expect(bad).toEqual([]);
  });
});
