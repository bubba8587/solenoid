// [[B12]] losslessSaves, [[react-flow-surface-contract#Undo history]]
// A run of edits a person might make, each made live and captured as the history captures it, then undone step by
// step and redone again by delta: every step lands the save and the answers the canvas had when it was captured.
// Stress it with more steps and other draws: STEPS=25 SALT=3 npx vitest run tests/graph/graphDeltaChain.test.ts The edits are drawn from a fixed seed per example, so a failure reproduces.
// Known at 20 steps (pack-fluids, SALT=1 and 6): a list of errors alone keeps the type its output last carried ([[D117]]
// emptyKeepsLastType), which no save holds, so Frame from Lists types that column Number live and Text after an undo or a reload.
import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";
import { nodeNameStore } from "../../src/graph/nodeNameStore";
import { serializeGraph, loadGraph, type SavedGraph } from "../../src/graph/persistence";
import { applyGraphDelta } from "../../src/graph/graphDelta";
import { sameLanding } from "../../src/graph/flow/flowHistoryDigest";
import { readFrame } from "../../src/graph/frameBackend";
import { SEEDS } from "../../src/graph/seeds";

const STEPS = Number(process.env.STEPS ?? 6);

let editor: GraphEditor<Schemes>;
let engine: DataflowEngine<Schemes>;

beforeEach(() => {
  forgetAllNodes();
  editor = new GraphEditor<Schemes>();
  engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const pos = new Map<string, { x: number; y: number }>();
  const view = {
    hasNode: (id: string) => pos.has(id),
    position: (id: string) => pos.get(id) ?? { x: 0, y: 0 },
    moveNode: async (id: string, p: { x: number; y: number }) => { pos.set(id, { ...p }); },
    nodeElement: () => null,
    measured: () => ({ w: 100, h: 60 }),
    container: { clientWidth: 800, clientHeight: 600 },
    pan: async () => {},
    zoom: async () => {},
    setCamera: async () => {},
    rerenderNode: async () => {},
    rerenderCables: async () => {},
    transform: { x: 0, y: 0, k: 1 },
  } as unknown as View;
  setEditorRefs(editor, engine, view);
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

/** A small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every output as the last pass landed it, comparable across loads: a lazy frame read whole (its handle is new on
 *  every run) and a card's per-load id (an error's origin) written as its name. */
async function answers(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const named = (text: string) => text.replace(/\b[0-9a-f]{16}\b/g, (id) => nodeNameStore.get(id) ?? id);
  for (const n of editor.getNodes()) {
    const name = nodeNameStore.get(n.id) ?? n.id;
    for (const key of Object.keys(n.outputs)) {
      let v: unknown;
      try { v = await readFrame(engine.landed(n.id, key)); } catch { v = "<unreadable>"; }
      out[`${name}.${key}`] = named(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x)) ?? "undefined");
    }
  }
  return out;
}

async function whole(g: SavedGraph): Promise<{ save: SavedGraph; answers: Record<string, string> }> {
  expect(await loadGraph(structuredClone(g), { curtain: false })).toBe(true);
  return { save: serializeGraph()!, answers: await answers() };
}

const asStep = (g: SavedGraph): SavedGraph => { const { nodes, ...head } = structuredClone(g); return { ...head, nodes }; };

/** One edit: a card deleted, moved, relabeled, folded, renamed, pinned and commented, typed into or copied, a cable
 *  cut, or a cut cable wired back. */
function step(g: SavedGraph, r: () => number, cut: SavedGraph["connections"]): { save: SavedGraph; what: string } {
  const out = structuredClone(g);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  if (out.nodes.length === 0) return { save: out, what: "nothing" };
  const n = pick(out.nodes);
  switch (Math.floor(r() * 11)) {
    case 0: {
      // As Delete does: an FC docked to the card goes with it, and every group lets the card go.
      const doomed = new Set([n.id, ...out.nodes.filter((m) => m.init?.hostNodeId === n.id).map((m) => m.id)]);
      out.nodes = out.nodes.filter((m) => !doomed.has(m.id));
      out.connections = out.connections.filter((c) => !doomed.has(c.source) && !doomed.has(c.target));
      out.standoffs = out.standoffs?.filter((st) => !doomed.has(st.a.nodeId) && !doomed.has(st.b.nodeId));
      out.pins = out.pins?.filter((p) => !doomed.has(p.nodeId));
      out.comments = out.comments?.filter((c) => !doomed.has(c.nodeId));
      out.frameFormats = out.frameFormats?.filter((f) => !doomed.has(f.nodeId));
      for (const m of out.nodes) {
        if (Array.isArray(m.init?.members)) m.init = { ...m.init, members: (m.init.members as string[]).filter((x) => !doomed.has(x)) };
      }
      return { save: out, what: `delete ${[...doomed].join(", ")}` };
    }
    case 1: n.x += 30; n.y += 20; return { save: out, what: `move ${n.id}` };
    case 2: n.init = { ...n.init, label: `L${Math.floor(r() * 100)}` }; return { save: out, what: `relabel ${n.id}` };
    case 3: n.collapsed = !n.collapsed; return { save: out, what: `fold ${n.id}` };
    case 4: {
      if (!out.connections.length) return { save: out, what: "no cable" };
      const c = pick(out.connections);
      out.connections = out.connections.filter((x) => x !== c);
      cut.push(c);
      return { save: out, what: `cut ${c.source}.${c.sourceOutput} -> ${c.target}.${c.targetInput}` };
    }
    case 5: {
      const back = cut.pop();
      const ids = new Set(out.nodes.map((m) => m.id));
      if (!back || !ids.has(back.source) || !ids.has(back.target)) return { save: out, what: "nothing to wire back" };
      out.connections.push(back);
      return { save: out, what: `wire back ${back.source} -> ${back.target}` };
    }
    case 6: {
      const to = `${n.id}_r`;
      if (out.nodes.some((m) => m.id === to)) return { save: out, what: "name taken" };
      for (const c of out.connections) { if (c.source === n.id) c.source = to; if (c.target === n.id) c.target = to; }
      for (const side of [out.pins, out.comments, out.frameFormats] as Array<Array<{ nodeId: string }> | undefined>)
        for (const e of side ?? []) if (e.nodeId === n.id) e.nodeId = to;
      for (const st of out.standoffs ?? []) for (const end of [st.a, st.b]) if (end.nodeId === n.id) end.nodeId = to;
      n.id = to; n.name = to;
      return { save: out, what: `rename to ${to}` };
    }
    case 8:
    case 9: {
      // A typed value: a number field, an input's value, a digit in a table.
      const typed = out.nodes.filter((m) => Object.keys(m.literals ?? {}).length || ["ValueInputNode", "SliderInputNode", "FrameInputNode"].includes(m.type));
      if (!typed.length) return { save: out, what: "nothing typed" };
      const t = pick(typed);
      const v = 1 + Math.floor(r() * 9);
      if (t.type === "ValueInputNode") t.init = { ...t.init, value: String(v) };
      else if (t.type === "SliderInputNode") t.init = { ...t.init, value: v };
      else if (t.type === "FrameInputNode" && typeof t.init.frameText === "string") t.init = { ...t.init, frameText: (t.init.frameText as string).replace(/\d/, String(v)) };
      else { const k = Object.keys(t.literals!)[0]; t.literals = { ...t.literals, [k]: v }; }
      return { save: out, what: `type ${v} into ${t.id}` };
    }
    case 7: {
      const key = Object.keys(n.literals ?? {})[0] ?? "value";
      out.pins = [...(out.pins ?? []).filter((p) => p.nodeId !== n.id), { nodeId: n.id, outputKey: key }];
      out.comments = [...(out.comments ?? []), { id: `cm${900 + Math.floor(r() * 99)}`, nodeId: n.id, author: "Ann", text: "check", resolved: false, time: 1 }];
      return { save: out, what: `pin and comment ${n.id}` };
    }
    default: {
      const copy = { ...structuredClone(n), id: `${n.id}_c`, name: `${n.id}_c`, x: n.x + 50, y: n.y + 50 };
      if (out.nodes.some((m) => m.id === copy.id)) return { save: out, what: "copy taken" };
      out.nodes.push(copy);
      return { save: out, what: `copy ${n.id}` };
    }
  }
}

describe("a run of edits undone and redone by delta", () => {
  for (const [id, seed] of Object.entries(SEEDS)) {
    if (!Array.isArray(seed.graph.nodes)) continue;

    it(`seed ${id}`, async () => {
      const r = rng([...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7 + Number(process.env.SALT ?? 0)));
      const cut: SavedGraph["connections"] = [];
      // Each step is made live, as an edit is, and captured as the history captures it: a save of the live canvas.
      const first = await whole(seed.graph);
      const chain = [first];
      const steady = JSON.stringify((await whole(first.save)).answers) === JSON.stringify(first.answers);
      await whole(first.save);
      const whats: string[] = [];
      for (let i = 0; i < STEPS; i++) {
        const s = step(chain[i].save, r, cut);
        whats.push(s.what);
        if (!(await applyGraphDelta(asStep(s.save)))) await loadGraph(structuredClone(s.save), { curtain: false });
        chain.push({ save: serializeGraph()!, answers: await answers() });
      }
      const land = async (k: number, dir: string) => {
        const why = `${dir} to step ${k} (${whats.join("; ")})`;
        expect(await applyGraphDelta(asStep(chain[k].save)), why).not.toBeNull();
        expect(sameLanding(serializeGraph()!, chain[k].save), why).toBe(true);
        if (steady) expect(await answers(), why).toEqual(chain[k].answers);
      };
      for (let k = STEPS - 1; k >= 0; k--) await land(k, "undo");
      for (let k = 1; k <= STEPS; k++) await land(k, "redo");
    });
  }
});
