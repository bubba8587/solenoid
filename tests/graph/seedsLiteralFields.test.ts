// [[C28]] literalsIffEditable, [[inline-literal-maps#One field per input]]
import { describe, expect, it } from "vitest";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { restoreLiterals, type SavedLiterals } from "../../src/graph/literalFields";
import { SEEDS } from "../../src/graph/seeds";

// What a card computes from is what it shows: a load drops each saved value no field reads, so every value a seed or
// a fresh card holds must live in its input's field, or the load would silently change what the card answers.

type SavedNode = SavedLiterals & { id: string; type: string; init?: Record<string, unknown> & { internal?: { nodes: SavedNode[] } } };

function* everyNode(nodes: SavedNode[], where: string): Generator<[string, SavedNode]> {
  for (const sn of nodes) {
    yield [`${where} ${sn.id}`, sn];
    const inner = sn.init?.internal?.nodes;
    if (inner) yield* everyNode(inner, `${where} ${sn.id} >`);
  }
}

type Maps = { literals?: Record<string, unknown>; stringLiterals?: Record<string, unknown>; literalKinds?: Record<string, unknown> };
const copy = (n: Maps) => structuredClone({ literals: n.literals, stringLiterals: n.stringLiterals, literalKinds: n.literalKinds });

describe("saved literals live in their inputs' fields", () => {
  const reg = ctorRegistry();

  it("every class's fresh defaults survive a load's prune", () => {
    const lost: string[] = [];
    for (const [name, C] of reg) {
      const node = new C({}) as unknown as Maps;
      const before = copy(node);
      restoreLiterals(node, { literals: before.literals as Record<string, number>, stringLiterals: before.stringLiterals as Record<string, string> });
      if (JSON.stringify(copy(node)) !== JSON.stringify(before)) lost.push(`${name}: ${JSON.stringify(before)} → ${JSON.stringify(copy(node))}`);
    }
    expect(lost).toEqual([]);
  });

  it("every seed node, nested ones too, keeps what it saved", () => {
    const lost: string[] = [];
    for (const [id, seed] of Object.entries(SEEDS)) {
      for (const [where, sn] of everyNode(seed.graph.nodes as SavedNode[], id)) {
        const C = reg.get(sn.type);
        if (!C) continue;
        const node = new C({ ...sn.init }) as unknown as Maps;
        restoreLiterals(node, sn);
        for (const map of ["literals", "stringLiterals"] as const) {
          for (const key of Object.keys(sn[map] ?? {})) {
            if (!(key in (node[map] ?? {}))) lost.push(`${where} (${sn.type}) ${map}.${key}`);
          }
        }
        for (const key of Object.keys((sn.init?.literalKinds as object | undefined) ?? {})) {
          if (!(key in (node.literalKinds ?? {}))) lost.push(`${where} (${sn.type}) literalKinds.${key}`);
        }
      }
    }
    expect(lost).toEqual([]);
  });
});
