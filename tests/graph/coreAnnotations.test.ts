// [[D102]] graphOnCore, [[D99]] rustIsSpec, [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream
// The annotation walk's frozen answers (fixtures/core/annotations.json.gz): every seed graph, as saved, with every third
// cable dropped and in reverse node order, once its types settle: each output's annotation and the one downstream that
// governs it, each input's annotation, and each node's value origin; with the facts the walk reads (`annotationFacts`).
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { frozen } from "./coreFixtures";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import * as Nodes from "../../src/graph/nodeClasses";
import { SEEDS } from "../../src/graph/seeds";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";
import { makeAnnotationResolver } from "../../src/graph/unitFlow";
import { annotationFacts, type AnnotationFacts } from "../../src/graph/annotationFacts";
import type { Schemes } from "../../src/graph/schemes";

type SavedNode = { id: string; type: string; init?: Record<string, unknown> };
type SavedConn = { source: string; sourceOutput: string; target: string; targetInput: string };
type Cable = [source: string, sourceOutput: string, target: string, targetInput: string];

const Ctors = Nodes as unknown as Record<string, new (init?: Record<string, unknown>) => GraphNode>;

/** A seed's nodes and cables in a fresh editor, ids renamed to the seed's so a case reads the same every run. */
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
  const cables: Cable[] = [];
  seed.connections.forEach((sc, i) => {
    if (variant === 1 && i % 3 === 0) return;
    cables.push([sc.source, sc.sourceOutput, sc.target, sc.targetInput]);
  });
  const kept: Cable[] = [];
  for (const c of cables) {
    const s = byId.get(c[0]), t = byId.get(c[2]);
    if (!s?.outputs[c[1]] || !t?.inputs[c[3]]) continue;
    if (editor.getConnections().some((x) => x.target === t.id && x.targetInput === c[3])) continue;
    await editor.addConnection(new GraphConnection(s, c[1], t, c[3]) as never);
    kept.push(c);
  }
  const seedId = new Map([...byId].map(([sid, n]) => [n.id, sid]));
  return { editor, seedId, kept };
}

type Want = { out: Record<string, unknown>; down: Record<string, unknown>; in: Record<string, unknown>; origin: Record<string, string> };
type Case = { graph: string; facts: AnnotationFacts[]; cables: Cable[]; want: Want };

function answers(editor: GraphEditor<Schemes>, seedId: Map<string, string>): { facts: AnnotationFacts[]; want: Want } {
  const nm = (id: string) => seedId.get(id) ?? id;
  const r = makeAnnotationResolver(editor as never);
  const want: Want = { out: {}, down: {}, in: {}, origin: {} };
  for (const n of editor.getNodes() as unknown as GraphNode[]) {
    for (const k in n.outputs) {
      want.out[`${nm(n.id)}.${k}`] = r.outAnnotation(n.id, k) ?? null;
      want.down[`${nm(n.id)}.${k}`] = r.downstreamAnnotation(n.id, k) ?? null;
    }
    for (const k in n.inputs) want.in[`${nm(n.id)}.${k}`] = r.inAnnotation(n.id, k) ?? null;
    want.origin[nm(n.id)] = nm(r.valueOrigin(n.id));
  }
  const facts = annotationFacts(editor as never).map((f) => ({ ...f, id: nm(f.id) }));
  return { facts, want };
}

describe("the annotation walk holds to its frozen answers", () => {
  it("every seed graph, three ways", async () => {
    const fresh: Case[] = [];
    for (const [id, seed] of Object.entries(SEEDS) as [string, { graph: { nodes: SavedNode[]; connections: SavedConn[] } }][]) {
      for (const variant of [0, 1, 2]) {
        const { editor, seedId, kept } = await build(seed.graph, variant);
        settleWildcardTypes(editor);
        fresh.push({ graph: `${id}#${variant}`, cables: kept, ...answers(editor, seedId) });
      }
    }
    const cases = frozen<Case>("annotations", () => fresh);
    expect(cases.length).toBeGreaterThan(60);
    expect(cases.some((c) => Object.values(c.want.out).some((a) => a !== null))).toBe(true);
    const now = new Map(fresh.map((c) => [c.graph, c]));
    const bad = cases.filter((c) => !isDeepStrictEqual(now.get(c.graph)?.want, c.want)).map((c) => c.graph);
    expect(bad).toEqual([]);
  });
});
