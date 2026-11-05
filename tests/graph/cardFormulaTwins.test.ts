// [[C17]] shareImpl, [[formula-language#Shared kernels]]
import { isSolDate, solDate } from "../../src/graph/dateValue";
import { describe, it, expect } from "vitest";
import { NODE_EXCEL } from "../../src/graph/nodeExcel";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { flattenLeaves } from "../../src/graph/catalogSearch";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { opsFor } from "../../src/graph/nodeOps";

/** Pairs the in-order mapping can't compare, each with why: a card's type for all its pairs, or `type:NAME` for one. */
const UNCOMPARED: Record<string, string> = {
  "constant:TRUE": "the Constant card holds the math constants; TRUE and FALSE are Value Input's",
  "constant:FALSE": "the Constant card holds the math constants; TRUE and FALSE are Value Input's",
  "convert": "answers an angle with its unit ([[C25]] firstClassUnits), where DEGREES and RADIANS answer a bare number",
  "sumifs": "takes a table and column pickers, not the function's ranges",
  "gcd-lcm": "pairs two lists item by item, where GCD folds every argument into one answer",
  "lcm": "pairs two lists item by item, where LCM folds every argument into one answer",
  "cx-unpack": "answers Real, Imag, |z| and arg(z) on four outputs at once, one per function",
  "cast:TEXT": "Cast's Format takes text; TEXT reads a number there as its format code",
  "z-test:Z.TEST": "the card reads a σ of 0 as left out and uses the sample's spread, where Z.TEST(…, 0) has none (Excel's #DIV/0!)",
  "date-diff-days:DAYS": "the card reads its start before its end, where DAYS takes the end first",
};

/** A function whose op wears Solenoid's own name: ISLOGICAL is the Type Check card's ISBOOLEAN. */
const OP_NAMES: Record<string, string> = { ISLOGICAL: "ISBOOLEAN" };

const POOL = [0.5, 2, 3, 7, 1.5, -2, 10, 0, 1, 4.25, 100, 0.1];

/** A value as the comparison reads it: numbers to 12 digits, an error by its code, a date by its day, lists item by item. */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shape);
  if (isSolDate(v)) return { date: shape(v.__date) };
  if (v && typeof v === "object" && (v as { __solError?: boolean }).__solError) return (v as { code: string }).code;
  if (typeof v === "number") return Number.isFinite(v) ? +v.toPrecision(12) : String(v);
  return v;
}

describe("cards answer as their formula twins", () => {
  const leaves = new Map(flattenLeaves(buildCatalog(false)).map((l) => [l.leaf.type, l.leaf]));
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
    // A card with an op per function is created set to this function's op: the op naming it by its formula name or its
    // label, else its search row (`excelEntry`).
    const decl = opsFor(type);
    const named = OP_NAMES[name] ?? name;
    const op = decl?.ops?.find((o) => (o.fx ?? o.label).replace(/\s+/g, "").toUpperCase() === named)
      ?? decl?.ops?.find((o) => (o.keywords ?? "").split(/\s*\/\s*/).includes(name));
    const make = op && decl?.create ? () => decl.create!(op.op)
      : (leaves.get(`${type}__excel-${name}`) ?? leaves.get(type) as { create: () => unknown }).create;
    const node = make() as {
      form?: string;
      inputs: Record<string, { socket?: { name?: string } } | undefined>;
      data: (inputs: Record<string, unknown[]>) => unknown;
    };
    // A distribution's right tail and two tails are its card's RT and 2T forms (F.DIST.RT is the F op in RT).
    // An inverse is its card's INV, INV RT or INV 2T form, which swaps the first input for the probability.
    const setForm = (node as { setForm?: (f: string) => void }).setForm?.bind(node);
    const inv = /\.INV(\.RT|\.2T)?$/.exec(name);
    if (setForm && inv) setForm(inv[1] === ".RT" ? "invrt" : inv[1] === ".2T" ? "inv2t" : "inv");
    else if (node.form !== undefined && name.endsWith(".RT")) node.form = "rt";
    else if (node.form !== undefined && name.endsWith(".2T")) node.form = "2t";
    // A card that orders its inputs itself (a form swaps one in) says so; otherwise they read in the order added.
    const keys = (node as { inputKeys?: string[] }).inputKeys ?? Object.keys(node.inputs ?? {});
    const syntax = NODE_EXCEL[type].find((e) => e.syntax?.includes(`${name}(`))!.syntax!;
    const args = /\(([^)]*)\)/.exec(syntax)![1].split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("["));
    if (keys.length !== args.length) return; // inputs and arguments don't line up one to one: nothing to compare
    // `any` is the scalar wildcard; every other wildcard rung can carry a list.
    const listy = (k: string) => /list|table|anycombo|anydata|trueany/.test(String(node.inputs[k]?.socket?.name ?? ""));
    // A date input takes its values as dates on both sides ([[D114]] dateIsAKind).
    const dated = (k: string) => /^date/.test(String((node.inputs[k]?.socket as { dataType?: string } | undefined)?.dataType ?? ""));
    const asDate = (v: unknown): unknown => (typeof v === "number" ? solDate(v) : Array.isArray(v) ? v.map(asDate) : v);
    const misses: string[] = [];
    for (let t = 0; t < 12; t++) {
      const vals = keys.map((k, i) => {
        const v = listy(k)
          ? [0, 1, 2, 3].map((j) => POOL[(t * 3 + i * 5 + j * 7) % POOL.length])
          : POOL[(t * 7 + i * 5 + t * i) % POOL.length];
        return dated(k) ? asDate(v) : v;
      });
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
    expect(misses.length, misses.slice(0, 3).join("\n")).toBe(0);
  });
});
