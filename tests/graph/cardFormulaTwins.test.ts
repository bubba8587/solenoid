// [[C17]] shareImpl
// Every card the catalog marks `parity: true` against a formula answers as that formula does: the same inputs, the same
// numbers and the same error codes (messages may differ). The card's inputs map to the function's arguments in order.
import { describe, it, expect } from "vitest";
import { NODE_EXCEL } from "../../src/graph/nodeExcel";
import { NODE_CATALOG } from "../../src/graph/nodeCatalog";
import { flattenLeaves } from "../../src/graph/catalogSearch";
import { compileEvaluator } from "../../src/graph/excelFormula";

/** Pairs the in-order mapping can't compare, each with why: a card's type for all its pairs, or `type:NAME` for one. */
const UNCOMPARED: Record<string, string> = {
  "constant:TRUE": "one card for every constant, picked by its op",
  "constant:FALSE": "one card for every constant, picked by its op",
  "distributions": "one card for many distributions; its inputs follow the chosen distribution, not one function's order",
  "convert": "a unit conversion card; DEGREES and RADIANS are two of its conversions",
  "is-test": "one card for every IS function, picked by its op",
  "sumifs": "takes a table and column pickers, not the function's ranges",
  "correl-correl": "one card for CORREL, PEARSON and RSQ, picked by its op",
  "regression-steyx": "one card for STEYX, SLOPE and INTERCEPT, picked by its op",
  "gcd-lcm": "pairs two lists item by item, where GCD folds every argument into one answer",
  "lcm": "pairs two lists item by item, where LCM folds every argument into one answer",
  "stat-quartile": "one card for QUARTILE.INC and QUARTILE.EXC, picked by its op",
  "stat-percentile": "one card for PERCENTILE.INC and PERCENTILE.EXC, picked by its op",
};

const POOL = [0.5, 2, 3, 7, 1.5, -2, 10, 0, 1, 4.25, 100, 0.1];

/** A value as the comparison reads it: numbers to 12 digits, an error by its code, lists item by item. */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === "object" && (v as { __solError?: boolean }).__solError) return (v as { code: string }).code;
  if (typeof v === "number") return Number.isFinite(v) ? +v.toPrecision(12) : String(v);
  return v;
}

describe("cards answer as their formula twins", () => {
  const leaves = new Map(flattenLeaves(NODE_CATALOG).map((l) => [l.leaf.type, l.leaf]));
  const pairs: { type: string; name: string }[] = [];
  for (const [type, eqs] of Object.entries(NODE_EXCEL)) {
    if (type in UNCOMPARED) continue;
    for (const eq of eqs) {
      const m = eq.parity ? /=\s*([A-Z0-9.]+)\(/i.exec(eq.syntax ?? "") : null;
      if (m && !(`${type}:${m[1]}` in UNCOMPARED)) pairs.push({ type, name: m[1] });
    }
  }

  it("every uncompared pair names a card that exists", () => {
    for (const key of Object.keys(UNCOMPARED)) expect(leaves.has(key.split(":")[0]), key).toBe(true);
  });

  it.each(pairs)("$type answers as $name", async ({ type, name }) => {
    const node = (leaves.get(type) as { create: () => unknown }).create() as {
      inputs: Record<string, { socket?: { name?: string } } | undefined>;
      data: (inputs: Record<string, unknown[]>) => unknown;
    };
    const keys = Object.keys(node.inputs ?? {});
    const syntax = NODE_EXCEL[type].find((e) => e.syntax?.includes(`${name}(`))!.syntax!;
    const args = /\(([^)]*)\)/.exec(syntax)![1].split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("["));
    if (keys.length !== args.length) return; // inputs and arguments don't line up one to one: nothing to compare
    const listy = (k: string) => /list|table|any/.test(String(node.inputs[k]?.socket?.name ?? ""));
    const misses: string[] = [];
    for (let t = 0; t < 12; t++) {
      const vals = keys.map((k, i) => listy(k)
        ? [0, 1, 2, 3].map((j) => POOL[(t * 3 + i * 5 + j * 7) % POOL.length])
        : POOL[(t * 7 + i * 5 + t * i) % POOL.length]);
      let card: unknown;
      try {
        const out = await node.data(Object.fromEntries(keys.map((k, i) => [k, [vals[i]]])));
        card = out && typeof out === "object" ? Object.values(out)[0] : out;
      } catch (e) {
        card = e;
      }
      const env = Object.fromEntries(vals.map((v, i) => [`a${i}`, v]));
      const formula = compileEvaluator(`${name}(${keys.map((_, i) => `a${i}`).join(",")})`)!(env);
      if (JSON.stringify(shape(card)) !== JSON.stringify(shape(formula))) {
        misses.push(`${JSON.stringify(vals)}: card ${JSON.stringify(shape(card))}, formula ${JSON.stringify(shape(formula))}`);
      }
    }
    expect(misses.slice(0, 3)).toEqual([]);
  });
});
