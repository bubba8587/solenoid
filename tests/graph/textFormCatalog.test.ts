// [[B12]] losslessSaves, [[C28]] literalsIffEditable
import { describe, it, expect } from "vitest";
import { isDeepStrictEqual } from "node:util";
import type { ClassicPreset } from "rete";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { extractInit } from "../../src/graph/copyPaste";
import { writeTextForm, readTextForm } from "../../src/graph/textForm";
import type { SavedGraph, SavedNode, SavedConnection } from "../../src/graph/persistence";
import { CURRENT_SAVE_VERSION } from "../../src/graph/persistenceCore";

// persistenceSweep.test.ts proves init is a fixed point through a constructor; this proves the FILE
// carries it: every catalog node, every literal, and a cable on every socket survive the text form a
// save passes through, and the node rebuilt from what comes back captures the same init.

type AnyNode = Record<string, unknown>;

function savedNodeOf(n: ClassicPreset.Node, id: string): SavedNode {
  const a = n as unknown as AnyNode;
  const sn: SavedNode = { id, type: n.constructor.name, name: id, x: 0, y: 0, init: extractInit(n) };
  if (a.literals && typeof a.literals === "object") sn.literals = { ...(a.literals as Record<string, number>) };
  if (a.stringLiterals && typeof a.stringLiterals === "object") sn.stringLiterals = { ...(a.stringLiterals as Record<string, string>) };
  return sn;
}

function rebuildFrom(n1: ClassicPreset.Node, sn: SavedNode): ClassicPreset.Node {
  const Ctor = n1.constructor as new (init?: Record<string, unknown>) => ClassicPreset.Node;
  const n2 = new Ctor({ ...sn.init });
  const b = n2 as unknown as AnyNode;
  if (sn.literals && typeof b.literals === "object") b.literals = { ...sn.literals };
  if (sn.stringLiterals && typeof b.stringLiterals === "object") b.stringLiterals = { ...sn.stringLiterals };
  return n2;
}

const nonEmpty = (m?: Record<string, unknown>) => (m && Object.keys(m).length > 0 ? m : undefined);

function roundTrip(n: ClassicPreset.Node): string | null {
  const sn = savedNodeOf(n, "Subject");
  const connections: SavedConnection[] = [
    ...Object.keys(n.inputs).map((k) => ({ source: "Up", sourceOutput: "out", target: "Subject", targetInput: k })),
    ...Object.keys(n.outputs).map((k) => ({ source: "Subject", sourceOutput: k, target: "Down", targetInput: "in" })),
  ];
  const g: SavedGraph = {
    v: CURRENT_SAVE_VERSION,
    nodes: [
      { id: "Up", type: "NumberInputNode", name: "Up", x: 0, y: 0, init: {} },
      sn,
      { id: "Down", type: "DisplayNode", name: "Down", x: 0, y: 0, init: {} },
    ],
    connections,
  };
  let back: SavedGraph;
  try { back = readTextForm(writeTextForm(g)); } catch (e) { return `text form threw: ${e instanceof Error ? e.message : e}`; }
  const got = back.nodes.find((x) => x.name === "Subject");
  if (!got) return "node lost";
  const problems: string[] = [];
  const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
  if (!same(got.init, JSON.parse(JSON.stringify(sn.init)))) problems.push("init changed");
  if (!same(nonEmpty(got.literals), nonEmpty(sn.literals))) problems.push("literals changed");
  if (!same(nonEmpty(got.stringLiterals), nonEmpty(sn.stringLiterals))) problems.push("stringLiterals changed");
  const key = (c: SavedConnection) => `${c.source}.${c.sourceOutput}>${c.target}.${c.targetInput}`;
  if (!same(back.connections.map(key).sort(), connections.map(key).sort())) problems.push("connections changed");
  if (problems.length === 0) {
    const reInit = extractInit(rebuildFrom(n, got));
    if (!same(reInit, sn.init)) problems.push("rebuilt node captures a different init");
  }
  return problems.length ? problems.join(", ") : null;
}

describe("[[B12]] losslessSaves: every catalog node survives the text form with a cable on every socket", () => {
  it("default instances", () => {
    const broken: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let n: ClassicPreset.Node;
      try { n = entry.create() as ClassicPreset.Node; } catch { continue; }
      const why = roundTrip(n);
      if (why) broken.push(`${type}: ${why}`);
    }
    expect(broken).toEqual([]);
  });

  it("a literal map the user emptied stays empty instead of reviving the class defaults", () => {
    const broken: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let n: ClassicPreset.Node;
      try { n = entry.create() as ClassicPreset.Node; } catch { continue; }
      const a = n as unknown as AnyNode;
      if (typeof a.literals !== "object" && typeof a.stringLiterals !== "object") continue;
      if (typeof a.literals === "object") a.literals = {};
      if (typeof a.stringLiterals === "object") a.stringLiterals = {};
      const why = roundTrip(n);
      if (why) { broken.push(`${type}: ${why}`); continue; }
      const back = readTextForm(writeTextForm({ v: CURRENT_SAVE_VERSION, nodes: [savedNodeOf(n, "S")], connections: [] })).nodes[0];
      const b = rebuildFrom(n, back) as unknown as AnyNode;
      if (typeof a.literals === "object" && !isDeepStrictEqual(b.literals, {})) broken.push(`${type}: literals revived ${JSON.stringify(b.literals)}`);
      if (typeof a.stringLiterals === "object" && !isDeepStrictEqual(b.stringLiterals, {})) broken.push(`${type}: stringLiterals revived ${JSON.stringify(b.stringLiterals)}`);
    }
    expect(broken).toEqual([]);
  });

  it("socket keys typed by the user: dotted and λ formula variables, Knap variables", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { TemplateNode } = await import("../../src/graph/nodes/text");
    const expr = new ExpressionNode({ expr: "rate.annual * λ1 + x" });
    expect(Object.keys(expr.inputs)).toEqual(expect.arrayContaining(["rate.annual", "λ1"]));
    expect(roundTrip(expr)).toBeNull();
    const tpl = new TemplateNode({ sideVars: ["a-b", "two words", 'q"uote'] });
    expect(roundTrip(tpl)).toBeNull();
  });

  it("a user-keyed input's literal keeps its own map", () => {
    const g: SavedGraph = {
      v: CURRENT_SAVE_VERSION,
      nodes: [{ id: "E", type: "ExpressionNode", name: "E", x: 0, y: 0, init: { "lit:x": 1 }, literals: { "rate.annual": 2 }, stringLiterals: { "a b": "t" } }],
      connections: [],
    };
    const back = readTextForm(writeTextForm(g)).nodes[0];
    expect(back.init).toEqual({ "lit:x": 1 });
    expect(back.literals).toEqual({ "rate.annual": 2 });
    expect(back.stringLiterals).toEqual({ "a b": "t" });
  });
});
