// [[A1]] visualGraphCalculator, [[compute-pass#What triggers a pass]]
// An edit in place (a Format Controller, a name, a number), Insert Conduit, Delete, a cut cable, Wrap as Composite and
// Unpack pass over only what they reach (`editReach.ts`, `processEdited`). On
// every example, after each such edit made live, every card's answer is the one a whole pass from empty caches gives.
// Other draws: SALT=3 npx vitest run tests/graph/graphEditReach.test.ts
import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs, processGraph, setBulkSettle, processEdited } from "../../src/graph/process";
import { settleCableChange } from "../../src/graph/cableSettle";
import { reconcileFcs } from "../../src/graph/fcReconcile";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";
import { nodeNameStore } from "../../src/graph/nodeNameStore";
import { loadGraph } from "../../src/graph/persistence";
import { deleteSelection, deleteCables, insertConduitForCables } from "../../src/graph/canvasActions";
import { createCompositeFromSelection, unpackComposite } from "../../src/graph/compositeLogic";
import { CompositeNode, FormatControllerNode } from "../../src/graph/nodeClasses";
import { readFrame } from "../../src/graph/frameBackend";
import { hasVolatileDates } from "../../src/graph/volatileDates";
import { connectionStore, whenConnectionsSettled, hasInflightConnections } from "../../src/graph/connectionStore";
import { SEEDS } from "../../src/graph/seeds";

const STEPS = Number(process.env.STEPS ?? 4);

let editor: GraphEditor<Schemes>;
let engine: DataflowEngine<Schemes>;
let view: View;

beforeEach(() => {
  forgetAllNodes();
  editor = new GraphEditor<Schemes>();
  engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const pos = new Map<string, { x: number; y: number }>();
  view = {
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
  // The bulk settle the canvas installs: the types settle on the new wiring, then the pass.
  setBulkSettle(async (renderOnly, opts) => {
    settleCableChange(editor, view);
    await processGraph(undefined, renderOnly, opts);
  });
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

/** Every output as the last pass landed it, a lazy frame read whole (its handle is new on every run). */
async function answers(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const n of editor.getNodes()) {
    const name = nodeNameStore.get(n.id) ?? n.id;
    for (const key of Object.keys(n.outputs)) {
      let v: unknown;
      try { v = await readFrame(engine.landed(n.id, key)); } catch { v = "<unreadable>"; }
      out[`${name}.${key}`] = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x)) ?? "undefined";
    }
  }
  return out;
}

async function whole(): Promise<Record<string, string>> {
  engine.reset();
  await processGraph();
  return await answers();
}

/** Every background fetch landed and computed. */
async function landed(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    const cards = editor.getNodes().map((n) => n.id);
    const fetched = connectionStore.landedCount(cards);
    await whenConnectionsSettled();
    await whole();
    if (!hasInflightConnections() && connectionStore.landedCount(cards) === fetched) return;
  }
}

const select = (ids: ReadonlySet<string>) => {
  for (const n of editor.getNodes()) (n as { selected?: boolean }).selected = ids.has(n.id);
};

/** One live edit, and what it was. */
async function edit(r: () => number): Promise<string> {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const nodes = editor.getNodes();
  const name = (id: string) => nodeNameStore.get(id) ?? id;
  const kind = r();
  // An edit in place, through the pass the card's own field runs (`processEdited`), with what it moved beyond itself.
  if (kind < 0.04) {
    const fcs = nodes.filter((n): n is FormatControllerNode & typeof n => n instanceof FormatControllerNode);
    if (fcs.length) {
      const fc = pick(fcs);
      fc.unit = pick(["none", "usd", "percent", "m", "km"]);
      fc.format = pick(["auto", "decimal", "percent", "currency"]) as typeof fc.format;
      await processEdited(fc.id, reconcileFcs(editor, null));
      return `format ${name(fc.id)} as ${fc.format} in ${fc.unit}`;
    }
  }
  if (kind < 0.06) {
    const n = pick(nodes);
    n.label = `${n.label ?? "card"} 2`;
    await processEdited(n.id);
    return `rename ${name(n.id)}`;
  }
  if (kind < 0.1) {
    const withNumbers = nodes.filter((n) => Object.keys((n as { literals?: Record<string, number> }).literals ?? {}).length > 0);
    if (withNumbers.length) {
      const n = pick(withNumbers) as typeof nodes[number] & { literals: Record<string, number> };
      const key = pick(Object.keys(n.literals));
      n.literals[key] = Math.round((n.literals[key] ?? 0) * 2 + 1);
      await processEdited(n.id);
      return `set ${name(n.id)}.${key} to ${n.literals[key]}`;
    }
  }
  if (kind < 0.18 && editor.getConnections().length) {
    // Every cable off one output, as a person picks a bundle to route.
    const c = pick(editor.getConnections());
    const bundle = editor.getConnections().filter((x) => x.source === c.source && x.sourceOutput === c.sourceOutput);
    await insertConduitForCables(editor, view, {} as HTMLElement, { connIds: bundle.map((x) => x.id) } as Parameters<typeof insertConduitForCables>[3]);
    return `conduit ${bundle.length} off ${name(c.source)}.${c.sourceOutput}`;
  }
  if (kind < 0.3 && editor.getConnections().length) {
    const c = pick(editor.getConnections());
    await deleteCables(editor, { connIds: [c.id] } as Parameters<typeof deleteCables>[1]);
    return `cut ${name(c.source)}.${c.sourceOutput} -> ${name(c.target)}.${c.targetInput}`;
  }
  if (kind < 0.45) {
    const composites = nodes.filter((n) => n instanceof CompositeNode);
    if (composites.length) {
      const c = pick(composites);
      await unpackComposite(editor, view, c.id);
      return `unpack ${name(c.id)}`;
    }
  }
  if (kind < 0.7) {
    // A card and what it feeds, as a person lassoes a run of cards.
    const first = pick(nodes);
    const ids = new Set([first.id, ...editor.getConnections().filter((c) => c.source === first.id).map((c) => c.target)]);
    select(ids);
    const made = await createCompositeFromSelection(editor, view);
    select(new Set());
    return `wrap ${[...ids].map(name).join(", ")}${made ? "" : " (nothing wrapped)"}`;
  }
  const n = pick(nodes);
  const what = `delete ${name(n.id)} (${n.constructor.name})`;
  select(new Set([n.id]));
  await deleteSelection(editor, view);
  return what;
}

describe("an edit's pass over what it reaches lands the whole pass's answers", () => {
  for (const [id, seed] of Object.entries(SEEDS)) {
    if (!Array.isArray(seed.graph.nodes)) continue;

    it(`seed ${id}`, async () => {
      const r = rng([...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 11 + Number(process.env.SALT ?? 0)));
      expect(await loadGraph(structuredClone(seed.graph), { curtain: false })).toBe(true);
      // A live card (a vault folder, a file) fetches in the background and answers on a later pass, so the cards are
      // let land before anything is compared.
      await landed();
      // A second whole pass lands the same answers, or the first left a card short of its fixed point. An example
      // holding a clock is left out: its answers move with the time.
      const loaded = await whole();
      const again = await whole();
      if (hasVolatileDates(editor.getNodes())) return;
      expect(again, "a whole pass after the load").toEqual(loaded);
      const whats: string[] = [];
      for (let i = 0; i < STEPS && editor.getNodes().length; i++) {
        const cards = editor.getNodes().map((n) => n.id);
        const fetched = connectionStore.landedCount(cards);
        whats.push(await edit(r));
        const partial = await answers();
        const full = await whole();
        // A fetch the edit started moves the answers when it lands, whichever pass ran: that step isn't compared.
        if (hasInflightConnections() || connectionStore.landedCount(cards) !== fetched) { await landed(); continue; }
        const off = Object.keys(full).filter((k) => full[k] !== partial[k])
          .map((k) => `${k}: ${partial[k]?.slice(0, 300)} where a whole pass gives ${full[k]?.slice(0, 300)}`);
        expect(off, whats.join("; ")).toEqual([]);
      }
    });
  }
});
