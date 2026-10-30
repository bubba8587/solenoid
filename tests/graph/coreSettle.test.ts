// [[C130]] rustCore, [[D99]] rustIsSpec, [[C10]] socketLattice
// The Type Settle's frozen answers (fixtures/core/settle.json.gz): every seed graph, as saved, with every third cable
// dropped and in reverse node order, as the facts the settle reads (`settleFacts`), the cables, and every socket's
// type once it has settled.
import { describe, expect, it } from "vitest";
import { frozen } from "./coreFixtures";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import * as Nodes from "../../src/graph/nodeClasses";
import { SEEDS } from "../../src/graph/seeds";
import { settleFacts, type NodeFacts } from "../../src/graph/settleFacts";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";
import type { Schemes } from "../../src/graph/schemes";

type SavedNode = { id: string; type: string; init?: Record<string, unknown> };
type SavedConn = { source: string; sourceOutput: string; target: string; targetInput: string };
type Cable = [source: string, sourceOutput: string, target: string, targetInput: string];
type Settled = { types: Record<string, { ins: Record<string, string>; outs: Record<string, string> }>; conduitChanged: boolean; adopted: string[] };
type Case = { graph: string; facts: NodeFacts[]; cables: Cable[]; want?: Settled };

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

function answer(editor: GraphEditor<Schemes>, seedId: Map<string, string>, settled: { conduitChanged: boolean; adopted: Set<string> }): Settled {
  const types: Settled["types"] = {};
  for (const n of editor.getNodes() as unknown as GraphNode[]) {
    const ins: Record<string, string> = {}, outs: Record<string, string> = {};
    for (const k in n.inputs) ins[k] = n.inputs[k]!.socket.name;
    for (const k in n.outputs) outs[k] = (n.outputs[k]!.socket as { dataType?: string }).dataType ?? n.outputs[k]!.socket.name;
    for (const k in n.inputs) ins[k] = (n.inputs[k]!.socket as { dataType?: string }).dataType ?? ins[k];
    types[seedId.get(n.id)!] = { ins, outs };
  }
  return { types, conduitChanged: settled.conduitChanged, adopted: [...settled.adopted].map((id) => seedId.get(id)!).sort() };
}

const renamed = (facts: NodeFacts[], seedId: Map<string, string>): NodeFacts[] => facts.map((f) => ({ ...f, id: seedId.get(f.id)! }));

describe("the Type Settle holds to its frozen answers", () => {
  it("every seed graph, three ways", async () => {
    const fresh: Case[] = [];
    for (const [id, seed] of Object.entries(SEEDS) as [string, { graph: { nodes: SavedNode[]; connections: SavedConn[] } }][]) {
      for (const variant of [0, 1, 2]) {
        const { editor, seedId, kept } = await build(seed.graph, variant);
        const facts = renamed(settleFacts(editor), seedId);
        const settled = settleWildcardTypes(editor);
        fresh.push({ graph: `${id}#${variant}`, facts, cables: kept, want: answer(editor, seedId, settled) });
      }
    }
    const cases = frozen<Case>("settle", () => fresh);
    expect(cases.length).toBeGreaterThan(60);
    expect(cases.some((c) => c.want!.adopted.length > 0)).toBe(true);
    expect(cases.some((c) => c.want!.conduitChanged)).toBe(true);
    const now = new Map(fresh.map((c) => [c.graph, c]));
    const bad = cases.filter((c) => JSON.stringify(now.get(c.graph)?.want) !== JSON.stringify(c.want) || JSON.stringify(now.get(c.graph)?.facts) !== JSON.stringify(c.facts));
    expect(bad.map((c) => c.graph)).toEqual([]);
  });
});
