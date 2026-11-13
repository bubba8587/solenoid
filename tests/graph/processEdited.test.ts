// [[C23]] calcModes, [[compute-pass#What triggers a pass]]
// A card edited in place recomputes its own reach (`processEdited`), and the reach of each card the edit moved beyond
// it; cards that changed on their own (fetches landing) recompute their reaches together
// (`processChanged`). Each is read through what the cards answer: a card left out of the pass keeps its old answer.
import { describe, expect, it, vi } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import { ArithmeticNode } from "../../src/graph/nodeClasses";
import { processGraph, processEdited, processChanged, setEditorRefs } from "../../src/graph/process";
import type { Schemes } from "../../src/graph/schemes";
import type { View } from "../../src/graph/view";

/** Three separate chains, a → b, c → d and e → f, each a product feeding a sum: a is 2 × 21, c is 3 × 1, e 4 × 1. */
async function twoChains() {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
  const card = (op: string, literals: Record<string, number>) => { const n = new ArithmeticNode({ op } as never); n.literals = literals; return n; };
  const a = card("mul", { a: 2, b: 21 }), b = card("add", { b: 0 });
  const c = card("mul", { a: 3, b: 1 }), d = card("add", { b: 0 });
  const e = card("mul", { a: 4, b: 1 }), f = card("add", { b: 0 });
  for (const n of [a, b, c, d, e, f]) await editor.addNode(n as unknown as Schemes["Node"]);
  for (const [from, to] of [[a, b], [c, d], [e, f]]) {
    await editor.addConnection(new GraphConnection(from, "result", to, "a") as unknown as Schemes["Connection"]);
  }
  await processGraph();
  const answer = (n: ArithmeticNode) => engine.landed(n.id, "result");
  expect([answer(b), answer(d), answer(f)]).toEqual([42, 3, 4]);
  return { a, b, c, d, e, f, answer };
}

describe("the pass after an edit", () => {
  it("recomputes the edited card's reach and leaves every other card as it was", async () => {
    const { a, b, c, d, answer } = await twoChains();
    a.literals.b = 10;
    c.literals.b = 5; // changed but never reported: a pass that reaches c would show it
    await processEdited(a.id);
    expect(answer(b)).toBe(20);
    expect(answer(d)).toBe(3);
  });

  it("covers a card the edit moved outside that reach, read afresh, and still no other card", async () => {
    const { a, b, c, d, e, f, answer } = await twoChains();
    a.literals.b = 10;
    c.literals.b = 5;
    e.literals.b = 9; // never reported
    await processEdited(a.id, [c.id]);
    expect([answer(b), answer(d), answer(f)]).toEqual([20, 15, 4]);
  });

  it("stays the card's reach when what it retyped is inside it", async () => {
    const { a, b, c, d, answer } = await twoChains();
    a.literals.b = 10;
    c.literals.b = 5;
    await processEdited(a.id, [b.id]);
    expect([answer(b), answer(d)]).toEqual([20, 3]);
  });

  it("recomputes every landed card's reach at once", async () => {
    const { a, b, c, d, answer } = await twoChains();
    a.literals.b = 10;
    c.literals.b = 5;
    await processChanged([a.id, c.id]);
    expect([answer(b), answer(d)]).toEqual([20, 15]);
    c.literals.b = 7;
    await processChanged([a.id]);
    expect(answer(d)).toBe(15);
  });
});
