// [[C130]] rustCore, [[D99]] rustIsSpec
// The Conduit walks' frozen answers (fixtures/core/conduit-walks.json.gz): over seeded random graphs of sources, Conduits
// (chained, fanned out, looped) and sinks, where each output's value really comes from (`resolveTypedSource`) and the
// whole run every cable belongs to (`conduitPath`).
import { describe, expect, it } from "vitest";
import { frozen } from "./coreFixtures";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphInput, GraphNode, GraphOutput } from "../../src/graph/graphModel";
import { ConduitNode } from "../../src/graph/nodes/conduit";
import { resolveTypedSource, conduitPath } from "../../src/graph/conduitTrace";
import { numberSocket, trueAnySocket } from "../../src/graph/sockets";
import type { Schemes } from "../../src/graph/schemes";

type Graph = { nodes: { id: string; conduit: boolean }[]; cables: [id: string, source: string, out: string, target: string, input: string][] };
type Case = { graph: Graph; want?: { sources: Record<string, [string, string]>; paths: Record<string, unknown> } };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A seeded graph in a real editor, its ids renamed to stable ones. */
async function build(seed: number) {
  const r = rng(seed);
  const editor = new GraphEditor<Schemes>();
  const nodes: GraphNode[] = [];
  const nSrc = 1 + Math.floor(r() * 3), nCond = 1 + Math.floor(r() * 4), nSink = 1 + Math.floor(r() * 3);
  for (let i = 0; i < nSrc; i++) {
    const n = new GraphNode("Src");
    n.addOutput("out", new GraphOutput(numberSocket));
    nodes.push(n);
  }
  for (let i = 0; i < nCond; i++) nodes.push(new ConduitNode({}) as unknown as GraphNode);
  for (let i = 0; i < nSink; i++) {
    const n = new GraphNode("Sink");
    n.addInput("in", new GraphInput(trueAnySocket));
    nodes.push(n);
  }
  for (const n of nodes) await editor.addNode(n as never);
  const outs = nodes.flatMap((n) => Object.keys(n.outputs).map((k) => [n, k] as const));
  const ins = nodes.flatMap((n) => Object.keys(n.inputs).map((k) => [n, k] as const));
  const want = Math.floor(r() * (ins.length + 2));
  for (let i = 0; i < want; i++) {
    const [s, so] = outs[Math.floor(r() * outs.length)];
    const [t, ti] = ins[Math.floor(r() * ins.length)];
    if (editor.getConnections().some((c) => c.target === t.id && c.targetInput === ti)) continue;
    await editor.addConnection(new GraphConnection(s, so, t, ti) as never);
  }
  const name = new Map<string, string>();
  nodes.forEach((n, i) => name.set(n.id, `n${i}`));
  editor.getConnections().forEach((c, i) => name.set(c.id, `c${i}`));
  return { editor, name };
}

function answers(editor: GraphEditor<Schemes>, name: Map<string, string>): Case {
  const nm = (id: string) => name.get(id) ?? id;
  const graph: Graph = {
    nodes: editor.getNodes().map((n) => ({ id: nm(n.id), conduit: n instanceof ConduitNode })),
    cables: editor.getConnections().map((c) => [nm(c.id), nm(c.source), c.sourceOutput as string, nm(c.target), c.targetInput as string]),
  };
  const sources: Record<string, [string, string]> = {};
  for (const n of editor.getNodes()) {
    for (const k of Object.keys(n.outputs)) {
      const t = resolveTypedSource(editor as never, n.id, k);
      sources[`${nm(n.id)}.${k}`] = [nm(t.source), t.sourceOutput];
    }
  }
  const paths: Record<string, unknown> = {};
  for (const c of editor.getConnections()) {
    const p = conduitPath(editor as never, c as never);
    paths[nm(c.id)] = {
      connIds: p.connIds.map(nm),
      origin: [nm(p.origin.nodeId), p.origin.key],
      terminals: p.terminals.map((e) => [nm(e.nodeId), e.key]),
      conduits: p.conduits.map(nm),
    };
  }
  return { graph, want: { sources, paths } };
}

describe("the Conduit walks hold to their frozen answers", () => {
  it("every output's source and every cable's run, over 300 seeded graphs", async () => {
    const fresh: Case[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const { editor, name } = await build(seed);
      fresh.push(answers(editor, name));
    }
    const cases = frozen<Case>("conduit-walks", () => fresh);
    expect(cases.length).toBe(300);
    expect(cases.some((c) => Object.values(c.want!.paths).some((p) => (p as { conduits: string[] }).conduits.length > 1))).toBe(true);
    const bad = cases.filter((c, i) => JSON.stringify(c) !== JSON.stringify(fresh[i])).map((_, i) => i);
    expect(bad).toEqual([]);
  });
});
