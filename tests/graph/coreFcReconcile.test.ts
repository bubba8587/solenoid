// [[C130]] rustCore, [[D99]] rustIsSpec, [[C25]] firstClassUnits
// The Format Controller reconcile's frozen answers (fixtures/core/fc-reconcile.json.gz): every seed graph, as saved, with
// every third cable dropped and in reverse node order, and 300 seeded graphs of FCs, Displays and Converts, once its types
// settle: each FC's type and the from-unit a Convert
// ahead dictates, and each Convert's arrows; with the facts the reconcile reads (`fcFacts`).
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { frozen } from "./coreFixtures";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import * as Nodes from "../../src/graph/nodeClasses";
import { SEEDS } from "../../src/graph/seeds";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";
import { reconcileFcTypes } from "../../src/graph/fcReconcile";
import { fcFacts, type FcFacts } from "../../src/graph/fcFacts";
import type { Schemes } from "../../src/graph/schemes";

type SavedNode = { id: string; type: string; init?: Record<string, unknown> };
type SavedConn = { source: string; sourceOutput: string; target: string; targetInput: string };
type Cable = [source: string, sourceOutput: string, target: string, targetInput: string];

const Ctors = Nodes as unknown as Record<string, new (init?: Record<string, unknown>) => GraphNode>;

/** A seed's nodes and cables in a fresh editor under the seed's own ids, so a case reads the same every run. */
async function build(seed: { nodes: SavedNode[]; connections: SavedConn[] }, variant: number) {
  const editor = new GraphEditor<Schemes>();
  const byId = new Map<string, GraphNode>();
  const nodes = variant === 2 ? [...seed.nodes].reverse() : seed.nodes;
  for (const sn of nodes) {
    const Ctor = Ctors[sn.type];
    if (!Ctor) continue;
    let node: GraphNode;
    try { node = new Ctor({ ...sn.init }); } catch { continue; }
    byId.set(sn.id, node);
    await editor.addNode(node as never);
  }
  for (const n of byId.values()) {
    if (n instanceof Nodes.FormatControllerNode && n.hostNodeId) n.hostNodeId = byId.get(n.hostNodeId)?.id ?? "";
  }
  const kept: Cable[] = [];
  for (const [i, sc] of seed.connections.entries()) {
    if (variant === 1 && i % 3 === 0) continue;
    const s = byId.get(sc.source), t = byId.get(sc.target);
    if (!s?.outputs[sc.sourceOutput] || !t?.inputs[sc.targetInput]) continue;
    if (editor.getConnections().some((x) => x.target === t.id && x.targetInput === sc.targetInput)) continue;
    await editor.addConnection(new GraphConnection(s, sc.sourceOutput, t, sc.targetInput) as never);
    kept.push([sc.source, sc.sourceOutput, sc.target, sc.targetInput]);
  }
  const seedId = new Map([...byId].map(([sid, n]) => [n.id, sid]));
  return { editor, seedId, kept };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A seeded graph of typed inputs, FCs (free, and docked on an output or an input), Displays and Converts. */
async function random(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const editor = new GraphEditor<Schemes>();
  const nodes: GraphNode[] = [];
  const count = 3 + Math.floor(r() * 7);
  for (let i = 0; i < count; i++) {
    const kind = pick(["value", "value", "fc", "fc", "display", "convert"]);
    nodes.push(
      kind === "value" ? new Nodes.ValueInputNode({ op: pick(["number", "date", "text", "logical"]) } as never)
      : kind === "fc" ? new Nodes.FormatControllerNode({})
      : kind === "display" ? new Nodes.DisplayNode({})
      : new Nodes.ConvertNode({ fromUnit: pick(["km", "mi", "deg"]), toUnit: "m" }),
    );
  }
  for (const n of nodes) await editor.addNode(n as never);
  for (const n of nodes) {
    if (!(n instanceof Nodes.FormatControllerNode) || r() < 0.5) continue;
    const host = pick(nodes.filter((h) => h !== n));
    const side = r() < 0.7 ? "output" : "input";
    const keys = Object.keys(side === "output" ? host.outputs : host.inputs);
    if (!keys.length) continue;
    Object.assign(n, { hostNodeId: host.id, socketKey: pick(keys), side });
  }
  const outs = nodes.flatMap((n) => Object.keys(n.outputs).map((k) => [n, k] as const));
  const ins = nodes.flatMap((n) => Object.keys(n.inputs).map((k) => [n, k] as const));
  const kept: Cable[] = [];
  const name = new Map(nodes.map((n, i) => [n.id, `n${i}`]));
  for (let i = 0; outs.length && ins.length && i < ins.length + 2; i++) {
    const [s, so] = pick(outs), [t, ti] = pick(ins);
    if (s === t || editor.getConnections().some((c) => c.target === t.id && c.targetInput === ti)) continue;
    await editor.addConnection(new GraphConnection(s, so, t, ti) as never);
    kept.push([name.get(s.id)!, so, name.get(t.id)!, ti]);
  }
  return { editor, seedId: name, kept };
}

type Want = { fcs: Record<string, [type: string, dictated: string]>; converts: Record<string, [up: boolean, down: boolean]> };
type Case = { graph: string; facts: FcFacts[]; cables: Cable[]; want: Want };

function answers(editor: GraphEditor<Schemes>, seedId: Map<string, string>): Want {
  const nm = (id: string) => seedId.get(id) ?? id;
  reconcileFcTypes(editor, null);
  const want: Want = { fcs: {}, converts: {} };
  for (const n of editor.getNodes()) {
    if (n instanceof Nodes.FormatControllerNode) want.fcs[nm(n.id)] = [n.socketDataType, n.dictatedFromUnit];
    if (n instanceof Nodes.ConvertNode) want.converts[nm(n.id)] = [n.imposesUp, n.imposesDown];
  }
  return want;
}

describe("the Format Controller reconcile holds to its frozen answers", () => {
  it("every seed graph three ways, and 300 seeded graphs of FCs, Displays and Converts", async () => {
    const fresh: Case[] = [];
    for (const [id, seed] of Object.entries(SEEDS) as [string, { graph: { nodes: SavedNode[]; connections: SavedConn[] } }][]) {
      for (const variant of [0, 1, 2]) {
        const { editor, seedId, kept } = await build(seed.graph, variant);
        settleWildcardTypes(editor);
        const nm = (x: string) => seedId.get(x) ?? x;
        const facts = fcFacts(editor).map((f) => ({ ...f, id: nm(f.id), ...(f.fc?.host ? { fc: { ...f.fc, host: nm(f.fc.host) } } : {}) }));
        fresh.push({ graph: `${id}#${variant}`, facts, cables: kept, want: answers(editor, seedId) });
      }
    }
    for (let seed = 1; seed <= 300; seed++) {
      const { editor, seedId, kept } = await random(seed);
      settleWildcardTypes(editor);
      const nm = (x: string) => seedId.get(x) ?? x;
      const facts = fcFacts(editor).map((f) => ({ ...f, id: nm(f.id), ...(f.fc?.host ? { fc: { ...f.fc, host: nm(f.fc.host) } } : {}) }));
      fresh.push({ graph: `random#${seed}`, facts, cables: kept, want: answers(editor, seedId) });
    }
    const cases = frozen<Case>("fc-reconcile", () => fresh);
    expect(cases.length).toBeGreaterThan(60);
    expect(cases.filter((c) => Object.keys(c.want.fcs).length > 0).length).toBeGreaterThan(5);
    expect(cases.some((c) => Object.values(c.want.fcs).some(([, d]) => d !== ""))).toBe(true);
    const now = new Map(fresh.map((c) => [c.graph, c]));
    const bad = cases.filter((c) => !isDeepStrictEqual(now.get(c.graph)?.want, c.want)).map((c) => c.graph);
    expect(bad).toEqual([]);
  });
});
