// [[D122]] branchCardsSeeTheirTest
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../../src/graph/graphEditor";
import { GraphConnection } from "../../../src/graph/graphModel";
import { DataflowEngine } from "../../../src/graph/dataflowEngine";
import type { Schemes } from "../../../src/graph/schemes";
import { isSolError, solError, type SolError } from "../../../src/graph/errorValue";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { ArithmeticNode } from "../../../src/graph/nodes/scalar";
import { ChooseNode, IfNode, IfsNode, SwitchNode } from "../../../src/graph/nodes/logic";
import { isKeyedWildcard } from "../../../src/graph/keyedLiterals";
import { declaredTypeOf } from "../../../src/graph/sockets";

/** The card's answer with `#DIV/0!` wired into `slot`, the other slots typed. */
async function wired(card: IfNode | IfsNode | SwitchNode | ChooseNode, slot: string, literals: Record<string, number>) {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const div = new ArithmeticNode({ op: "div" });
  div.literals = { a: 1, b: 0 };
  // A wildcard slot takes keyed text; a logical or number slot its number field.
  card.literals = {};
  card.stringLiterals = {};
  for (const [k, v] of Object.entries(literals)) {
    if (isKeyedWildcard(declaredTypeOf(card.inputs[k]?.socket))) card.stringLiterals[k] = String(v);
    else card.literals[k] = v;
  }
  await editor.addNode(div);
  await editor.addNode(card);
  await editor.addConnection(new GraphConnection(div, "result", card, slot) as Schemes["Connection"]);
  return ((await engine.fetch(card.id)) as { result: unknown }).result;
}

const code = (v: unknown) => (isSolError(v) ? (v as SolError).code : v);
const formula = (expr: string) => code(compileEvaluator(expr)!({ bad: solError("#DIV/0!", "Division by zero") }));

describe("a branch card answers only its test's error and its chosen branch's, as its formula does", () => {
  it.each([
    ["IF, the branch not taken", () => new IfNode(), "else", { cond: 1, then: 7 }, 7, "IF(TRUE, 7, bad)"],
    ["IF, the branch taken", () => new IfNode(), "then", { cond: 1, else: 7 }, "#DIV/0!", "IF(TRUE, bad, 7)"],
    ["IF, the test", () => new IfNode(), "cond", { then: 7, else: 8 }, "#DIV/0!", "IF(bad, 7, 8)"],
    ["CHOOSE, a value not chosen", () => new ChooseNode(), "v1", { index: 1, v0: 7 }, 7, "CHOOSE(1, 7, bad)"],
    ["CHOOSE, the value chosen", () => new ChooseNode(), "v0", { index: 1, v1: 7 }, "#DIV/0!", "CHOOSE(1, bad, 7)"],
    ["CHOOSE, the index", () => new ChooseNode(), "index", { v0: 7, v1: 8 }, "#DIV/0!", "CHOOSE(bad, 7, 8)"],
    ["SWITCH, a result not matched", () => new SwitchNode(), "then1", { expr: 1, when0: 1, then0: 7, when1: 2, when2: 3, then2: 9 }, 7, "SWITCH(1, 1, 7, 2, bad, 3, 9)"],
    ["SWITCH, a case after the match", () => new SwitchNode(), "when1", { expr: 1, when0: 1, then0: 7, then1: 8, when2: 3, then2: 9 }, 7, "SWITCH(1, 1, 7, bad, 8, 3, 9)"],
    ["SWITCH, a case before the match", () => new SwitchNode(), "when0", { expr: 2, then0: 7, when1: 2, then1: 8, when2: 3, then2: 9 }, "#DIV/0!", "SWITCH(2, bad, 7, 2, 8, 3, 9)"],
    ["SWITCH, the expression", () => new SwitchNode(), "expr", { when0: 1, then0: 7, when1: 2, then1: 8, when2: 3, then2: 9 }, "#DIV/0!", "SWITCH(bad, 1, 7, 2, 8, 3, 9)"],
    ["IFS, a value not taken", () => new IfsNode(), "val1", { cond0: 1, val0: 7, cond1: 0, cond2: 0, val2: 9 }, 7, "IFS(TRUE, 7, FALSE, bad, FALSE, 9)"],
    ["IFS, the value taken", () => new IfsNode(), "val0", { cond0: 1, cond1: 0, val1: 8, cond2: 0, val2: 9 }, "#DIV/0!", "IFS(TRUE, bad, FALSE, 8, FALSE, 9)"],
    ["IFS, a test", () => new IfsNode(), "cond1", { cond0: 0, val0: 7, val1: 8, cond2: 1, val2: 9 }, "#DIV/0!", "IFS(FALSE, 7, bad, 8, TRUE, 9)"],
    ["IFS, a test after the match", () => new IfsNode(), "cond1", { cond0: 1, val0: 7, val1: 8, cond2: 0, val2: 9 }, 7, "IFS(TRUE, 7, bad, 8, FALSE, 9)"],
  ] as const)("%s", async (_, make, slot, literals, want, expr) => {
    expect(code(await wired(make(), slot, { ...literals }))).toBe(want);
    expect(formula(expr)).toBe(want);
  });

  it("an IF over a list of tests takes each cell from the branch it picks", async () => {
    const card = new IfNode();
    const out = card.data({ cond: [[true, false]], then: [[1, solError("#DIV/0!", "Division by zero")]], else: [[solError("#VALUE!", "x"), 4]] }).result;
    expect((out as unknown[]).map(code)).toEqual([1, 4]);
  });
});
