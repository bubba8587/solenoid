// [[D96]] emptySlotShowsItsValue, [[inline-literal-maps#What an empty field is]]
import { it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { flattenLeaves } from "../../src/graph/catalogSearch";
import { literalFieldOf } from "../../src/graph/literalFields";
import { emptyFieldShown } from "../../src/graph/emptySlots";
import type { InputRole } from "../../src/graph/inputRoles";

// Their fields are a formula's variables, walked as a kind of nothing of their own.
const VARIABLES = new Set(["ExpressionNode", "LambdaNode", "ComputedColumnNode"]);

it("every card field declares what it is when empty: Fallback, Behavior, Example or Required", () => {
  const undeclared = new Set<string>();
  for (const { leaf } of flattenLeaves(buildCatalog(false)) as { leaf: { create?: () => unknown } }[]) {
    let node: { constructor: { name: string; inputRoles?: Record<string, InputRole> }; inputs: Record<string, unknown>; op?: string };
    try { node = leaf.create?.() as typeof node; } catch { continue; }
    if (!node?.inputs) continue;
    const cls = node.constructor.name;
    if (VARIABLES.has(cls)) continue;
    for (const key of Object.keys(node.inputs)) {
      if (literalFieldOf(node as never, key) === "none") continue;
      if (!emptyFieldShown(cls, key, node.constructor.inputRoles?.[key], (node as { op?: string }).op)) undeclared.add(`${cls}.${key}`);
    }
  }
  expect([...undeclared].sort()).toEqual([]);
});

/** Pairs whose card field isn't the function's argument it lines up with, each with why. */
const TWINS_APART: Record<string, string> = {
  SUMIFS: "the card takes a table and column pickers, not the function's ranges",
  AVERAGEIFS: "the card takes a table and column pickers, not the function's ranges",
  MINIFS: "the card takes a table and column pickers, not the function's ranges",
  MAXIFS: "the card takes a table and column pickers, not the function's ranges",
  "QUARTILE.EXC": "the card's quart is QUARTILE.INC's too, where 0 is the minimum",
};

/** Card Fallbacks that aren't the formula's empty slot, armed when the 2026-11-05 parity audit marked their functions
 *  as Excel's. Which side moves is the author's pick, in the backlog ("Card-to-formula checks skip every
 *  `parity: false` row"); until then each is named here so a new one still fails. */
const EMPTY_PENDING = new Set([
  "ACCRINTM arg 3", "ACCRINTM arg 4", "BESSELI arg 1", "BESSELJ arg 1", "BESSELK arg 1", "BESSELY arg 1",
  "COUPDAYBS arg 3", "COUPDAYS arg 3", "COUPDAYSNC arg 3", "IMPOWER arg 2", "BETA.INV arg 2", "BETA.INV arg 3",
  "CHISQ.INV arg 2", "CHISQ.INV.RT arg 2", "F.INV arg 2", "F.INV arg 3", "F.INV.RT arg 2", "F.INV.RT arg 3",
  "GAMMA.INV arg 2", "GAMMA.INV arg 3", "NORM.INV arg 3", "T.INV arg 2", "T.INV.2T arg 2", "TBILLYIELD arg 3",
  "YIELDMAT arg 5", "ROMAN arg 1", "XIRR arg 2", "XNPV arg 1", "XNPV arg 3", "Z.TEST arg 3",
]);

it("a card's empty field reads as its formula twin's empty slot: a Fallback the same value, a Behavior left out", async () => {
  const { NODE_EXCEL } = await import("../../src/graph/nodeExcel");
  const { opsFor } = await import("../../src/graph/nodeOps");
  const { emptySlotReading } = await import("../../src/graph/emptySlots");
  const { LEFT_OUT } = await import("../../src/graph/inputRoles");
  const leaves = new Map((flattenLeaves(buildCatalog(false)) as { leaf: { type: string; create?: () => unknown } }[]).map((l) => [l.leaf.type, l.leaf]));
  const misses: string[] = [];
  for (const [type, eqs] of Object.entries(NODE_EXCEL)) {
    for (const eq of eqs) {
      const m = eq.parity ? /=\s*([A-Z0-9.]+)\(/i.exec(eq.syntax ?? "") : null;
      if (!m || m[1] in TWINS_APART) continue;
      const name = m[1];
      const decl = opsFor(type);
      const op = decl?.ops?.find((o) => (o.fx ?? o.label).replace(/\s+/g, "").toUpperCase() === name)
        ?? decl?.ops?.find((o) => (o.keywords ?? "").split(/\s*\/\s*/).includes(name));
      const make = op && decl?.create ? () => decl.create!(op.op) : (leaves.get(`${type}__excel-${name}`) ?? leaves.get(type))?.create;
      if (!make) continue;
      const node = make() as { constructor: { name: string; inputRoles?: Record<string, InputRole> }; inputs: Record<string, unknown>; op?: string };
      const keys = Object.keys(node.inputs ?? {});
      const params = /\(([^)]*)\)/.exec(eq.syntax!)![1].split(",").map((s) => s.trim()).filter(Boolean);
      if (keys.length > params.length || keys.length < params.filter((p) => !p.startsWith("[")).length) continue;
      keys.forEach((key, i) => {
        if (literalFieldOf(node as never, key) === "none") return;
        const card = emptyFieldShown(node.constructor.name, key, node.constructor.inputRoles?.[key], node.op);
        const slot = emptySlotReading(name, i);
        if (EMPTY_PENDING.has(`${name} arg ${i + 1}`)) return;
        const at = `${name} arg ${i + 1} / ${node.constructor.name}.${key}`;
        if (card?.kind === "fallback" && (card.shown ?? "") !== (slot.shown ?? "")) misses.push(`${at}: card ${card.shown ?? '""'}, formula ${slot.shown ?? '""'}`);
        if (card?.kind === "behavior" && slot.value !== LEFT_OUT) misses.push(`${at}: card ${card.shown}, formula reads ${String(slot.value)}`);
      });
    }
  }
  expect(misses).toEqual([]);
});

it("a card computes with what its empty field shows, through a real pass", async () => {
  const { inEditor } = await import("./cardPasses");
  const N = await import("../../src/graph/nodeClasses");
  const answer = async (node: { outputs: Record<string, unknown> }) => {
    const ed = await inEditor(node as never);
    const r = await ed.pass(Object.keys(node.outputs)[0]);
    ed.dispose();
    return r;
  };
  const gt = new N.ComparisonNode({ op: "gt" });
  gt.stringLiterals = { a: "5" };
  expect(await answer(gt)).toBe(true); // 5 > the empty B's 0
  const log = new N.TwoInputMathNode({ op: "log" });
  log.literals = { a: 1000 };
  expect(await answer(log)).toBeCloseTo(3, 12); // the empty base's 10
  const round = new N.RoundNNode();
  round.literals = { digits: 2 };
  expect(await answer(round)).toBe(0); // the empty number's 0, never an error
});
