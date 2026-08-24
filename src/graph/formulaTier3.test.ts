import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { EXCEL_IMPL_META, listReturningNames, wholeArgNames, resolveExcelFunction } from "./excelFunctions";
import {
  ReverseNode, SliceNode, NthElementNode, InterleaveNode, PadNode, DiffNode, NormalizeNode,
  ListLengthNode, ArgMinMaxNode, ContainsNode, WeightedNode, RunningNode, RUNNING_OP_META,
  SeriesNode,
  SetOpNode, SetRelationNode, FillNode, ConcatListsNode, PAD_OP_META, ARG_MIN_MAX_OP_META, WEIGHTED_OP_META,
  SET_OP_META, SET_RELATION_META, FILL_OP_META,
} from "./nodes/list";
import { buildCatalog } from "./catalogUtils";
import { despace as parityDespace } from "./formulaNodeParity";
import { NODE_OPS } from "./nodeOps";
import { TextFilterNode } from "./nodes/text";
import type { CatalogEntry, NodeCatalogEntry } from "./AddNodeMenu";

// ─── formulaNaming Tier 3: the node surface and the formula surface agree ───────────────
// Tier 3 makes the Solenoid-native list core callable from a formula. The whole point
// is that the two surfaces STOP being separate implementations, so the test that
// matters is not "does REVERSE work" but "does REVERSE answer what a REVERSE node
// answers". Both sides call `nodes/listOps.ts`; this is what stops someone reverting
// that by hand-inlining one of them again.
//
// Naming is formulaNaming decision 2(a): the formula name is the node's LABEL despaced, taken
// from the family's OP_META table. The name assertions below read the table rather
// than repeating the string, so renaming an op in one place fails here.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const despace = (label: string) => label.replace(/\s+/g, "").toUpperCase();

const LIST = [4, 1, 7, 2];
const WITH_GAP = [4, null, 7, 2];

describe("every Tier 3 name computes what its node computes", () => {
  it("REVERSE", () => {
    expect(ev("REVERSE(x)", { x: LIST })).toEqual(new ReverseNode().data({ list: [LIST] }).result);
  });

  it("SLICE — both the 2-arg (open end) and 3-arg forms", () => {
    const open = new SliceNode();
    expect(ev("SLICE(x, 2)", { x: LIST })).toEqual(open.data({ list: [LIST], start: [2] }).result);
    const closed = new SliceNode();
    expect(ev("SLICE(x, 2, 3)", { x: LIST })).toEqual(closed.data({ list: [LIST], start: [2], end: [3] }).result);
  });

  it("NTHELEMENT", () => {
    expect(ev("NTHELEMENT(x, 2)", { x: LIST })).toEqual(new NthElementNode().data({ list: [LIST], n: [2] }).result);
  });

  it("INTERLEAVE", () => {
    expect(ev("INTERLEAVE(a, b)", { a: [1, 2], b: [9] }))
      .toEqual(new InterleaveNode().data({ a: [[1, 2]], b: [[9]] }).result);
  });

  it("PADLEFT / PADRIGHT — one name per direction, from PAD_OP_META", () => {
    for (const [dir, meta] of Object.entries(PAD_OP_META)) {
      const node = new PadNode({ op: dir as "left" | "right" });
      expect(ev(`${meta.label}(x, 6, 0)`, { x: LIST }))
        .toEqual(node.data({ list: [LIST], n: [6], fill: [0] }).result);
      expect(despace(meta.label)).toBe(meta.label); // the name IS the label
    }
  });

  it("DIFF", () => {
    expect(ev("DIFF(x)", { x: LIST })).toEqual(new DiffNode().data({ list: [LIST] }).result);
  });

  it("NORMALIZE", () => {
    expect(ev("NORMALIZE(x)", { x: LIST })).toEqual(new NormalizeNode().data({ list: [LIST] }).result);
  });

  // The aggregatorsAreArguments contract in full: an ARGUMENT is a parameter INSIDE a top-level function.
  // Both halves matter. The family gets exactly ONE name — RUNNING(op, list, [window]),
  // like SORT carrying its direction — and the per-op names stay dead. The 2026-08-10
  // relapse to guard: "argument" was first misread as "no formula surface at all" and
  // the whole family was deleted; the fix is the op moving INTO the argument list,
  // never the function disappearing.
  it("RUNNING(op, list, [window]) — the family's ONE name; the aggregator is its argument", () => {
    for (const [op, meta] of Object.entries(RUNNING_OP_META)) {
      const node = new RunningNode({ op: op as never });
      expect(ev(`RUNNING("${meta.label}", x)`, { x: LIST }), meta.label)
        .toEqual(node.data({ list: [LIST] }).result);
    }
    // Windowed (Last N) through the optional third arg; op is case-insensitive.
    const win = new RunningNode({ op: "avg", mode: "window" });
    expect(ev('RUNNING("average", x, 2)', { x: LIST }))
      .toEqual(win.data({ list: [LIST], window: [2] }).result);
    // A BLANK window is unknown → blank; an unknown aggregator is a #VALUE!.
    expect(ev('RUNNING("sum", x, w)', { x: LIST, w: null })).toBeNull();
    const bad = ev('RUNNING("mode", x)', { x: LIST }) as { code?: string };
    expect(bad?.code).toBe("#VALUE!");
  });

  it("RUNNING* per-op names are NOT functions — the op is an argument, not seven names", () => {
    for (const name of ["RUNNINGSUM", "RUNNINGAVERAGE", "RUNNINGMIN", "RUNNINGMAX",
      "RUNNINGMEDIAN", "RUNNINGPRODUCT", "RUNNINGSTDEV"]) {
      expect(resolveExcelFunction(name), `${name} is dispatchable`).toBeNull();
    }
  });

  it("LENGTH — counts the missing slot, which is why it takes the list RAW", () => {
    expect(ev("LENGTH(x)", { x: WITH_GAP })).toBe(4);
    expect(ev("LENGTH(x)", { x: WITH_GAP })).toEqual(new ListLengthNode().data({ list: [WITH_GAP] }).result);
  });

  it("ARGMAX / ARGMIN / ARGSORT / WHICH", () => {
    // The descending op is ARGSORT's second argument on the formula side.
    const call: Record<string, string> = { argsort_desc: "ARGSORT(x, TRUE)" };
    for (const [op, meta] of Object.entries(ARG_MIN_MAX_OP_META)) {
      const node = new ArgMinMaxNode({ op: op as "argmax" });
      expect(ev(call[op] ?? `${despace(meta.label)}(x)`, { x: LIST }), meta.label).toEqual(node.data({ list: [LIST] }).result);
    }
  });

  it("CONTAINS", () => {
    expect(ev("CONTAINS(x, 7)", { x: LIST })).toEqual(new ContainsNode().data({ list: [LIST], value: [7] }).result);
    expect(ev("CONTAINS(x, 99)", { x: LIST })).toBe(false);
  });

  it("WAVG / WVAR / WSTDEV", () => {
    const values = [1, 2, 3], weights = [1, 1, 2];
    for (const [op, meta] of Object.entries(WEIGHTED_OP_META)) {
      const node = new WeightedNode({ op: op as "wavg" });
      expect(ev(`${meta.label}(x, w)`, { x: values, w: weights }), meta.label)
        .toEqual(node.data({ values: [values], weights: [weights] }).result);
    }
  });

  it("LINSPACE / REPEAT / GEOMETRIC / FIBONACCI", () => {
    expect(ev("LINSPACE(0, 1, 5)")).toEqual(new SeriesNode({ op: "linspace" }).data({ start: [0], end: [1], count: [5] }).list);
    expect(ev("REPEAT(7, 4)")).toEqual(new SeriesNode({ op: "repeat" }).data({ value: [7], count: [4] }).list);
    expect(ev("GEOMETRIC(1, 3, 5)")).toEqual(new SeriesNode({ op: "geometric" }).data({ start: [1], ratio: [3], count: [5] }).list);
    expect(ev("FIBONACCI(8)")).toEqual(new SeriesNode({ op: "fibonacci" }).data({ count: [8] }).list);
  });
});

describe("the whole-list routing, which is the half that isn't the function", () => {
  // The reason Tier 3 needed plumbing at all: without it the evaluator maps a call
  // element-wise over an array argument, so REVERSE([1,2,3]) would have run three
  // times on three scalars and answered [[1],[2],[3]].
  it("a list argument arrives WHOLE, not mapped element-wise", () => {
    expect(ev("REVERSE(x)", { x: [1, 2, 3] })).toEqual([3, 2, 1]);
  });

  it("nulls keep their POSITION — the aggregator null-drop would be wrong here", () => {
    expect(ev("REVERSE(x)", { x: [1, null, 3] })).toEqual([3, null, 1]);
    expect(ev("NTHELEMENT(x, 2)", { x: [1, null, 3, null] })).toEqual([1, 3]);
  });

  it("a cell error rides along in its own slot rather than being hoisted", () => {
    const out = ev("REVERSE(x)", { x: [1, { __solError: true, code: "#DIV/0!", message: "x" }, 3] }) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect((out[1] as { code?: string }).code).toBe("#DIV/0!");
    expect(out[0]).toBe(3);
  });

  it("a whole-list reducer still SURFACES an error rather than a number", () => {
    const r = ev("WAVG(x, w)", { x: [1, { __solError: true, code: "#DIV/0!", message: "x" }], w: [1, 1] });
    expect((r as { code?: string }).code).toBe("#DIV/0!");
  });

  it("a scalar widens to a 1-element list, like a cable into a list input", () => {
    expect(ev("REVERSE(5)")).toEqual([5]);
    expect(ev("LENGTH(5)")).toBe(1);
  });

  it("the results COMPOSE — a list-returning call feeds a range aggregate", () => {
    expect(ev("SUM(REVERSE(x))", { x: [1, 2, 3] })).toBe(6);
    expect(ev("REVERSE(NORMALIZE(x))", { x: [0, 5, 10] })).toEqual([1, 0.5, 0]);
  });

  it("a generator is capped at the formula boundary (the node's Count is a spinner)", () => {
    const r = ev("LINSPACE(0, 1, 2000000)");
    expect((r as { code?: string }).code).toBe("#OVERFLOW!");
    // Under the cap it just computes.
    expect((ev("LINSPACE(0, 1, 3)") as number[]).length).toBe(3);
  });
});

describe("the declarations stay honest", () => {
  it("every listArgs / list-rank name actually resolves", () => {
    for (const name of new Set([...listReturningNames(), ...wholeArgNames()])) {
      expect(resolveExcelFunction(name), `${name} declares a list contract but does not dispatch`).toBeTruthy();
    }
  });

  it("a list-RETURNING function also takes its args whole", () => {
    // The converse isn't true (LENGTH takes a list, returns a scalar), but a function
    // returning a list must never be broadcast — that is how a 2-D result gets built
    // behind noFramesInFormulas's back.
    for (const name of listReturningNames()) {
      expect(EXCEL_IMPL_META[name].listArgs, `${name} returns a list but would be broadcast`).toBe(true);
    }
  });

  it("declared arity matches what the registration accepts", () => {
    for (const name of wholeArgNames()) {
      const [min, max] = EXCEL_IMPL_META[name].arity;
      // RANDARRAY is Excel's one fully-optional-args generator: RANDARRAY() is a
      // legal call (one random number), so min 0 is its honest arity.
      expect(min, name).toBeGreaterThanOrEqual(name === "RANDARRAY" ? 0 : 1);
      expect(max, name).toBeGreaterThanOrEqual(min);
    }
  });
});

describe("the prose-labelled families — names DECLARED, not despaced", () => {
  // formulaNaming 2(a) despaces the label, which works only while the label is a NAME. These
  // three families label themselves in sentences ("Union: in A or B"), so each op
  // carries an `fx` beside its label. Same one-table principle, explicit instead of
  // derived — and the test reads the table, so a rename in one place fails here.
  it("SET* — one name per Set op", () => {
    const a = [1, 2, 3], b = [3, 4];
    for (const [op, meta] of Object.entries(SET_OP_META)) {
      const node = new SetOpNode({ op: op as "union" });
      expect(ev(`${meta.fx}(a, b)`, { a, b }), meta.fx)
        .toEqual(node.data({ a: [a], b: [b] }).result);
    }
  });

  it("SET* relations — one name per relation", () => {
    const a = [1, 2], b = [1, 2, 3];
    for (const [op, meta] of Object.entries(SET_RELATION_META)) {
      const node = new SetRelationNode({ op: op as "equal" });
      expect(ev(`${meta.fx}(a, b)`, { a, b }), meta.fx)
        .toEqual(node.data({ a: [a], b: [b] }).result);
    }
  });

  it("FILL* — one name per Fill op, except the variadic COALESCE", () => {
    const gappy = [1, null, null, 4];
    for (const [op, meta] of Object.entries(FILL_OP_META)) {
      if (op === "coalesce") continue; // N-ary — its own case below
      const node = new FillNode({ op: op as "ffill" });
      const call = op === "constant" ? `${meta.fx}(x, 0)` : `${meta.fx}(x)`;
      const nodeOut = op === "constant"
        ? node.data({ list: [gappy], value: [0] }).result
        : node.data({ list: [gappy] }).result;
      expect(ev(call, { x: gappy }), meta.fx).toEqual(nodeOut);
    }
  });

  it("COALESCE takes the first present across its sources, in order", () => {
    expect(ev("COALESCE(a, b, 99)", { a: [1, null, null], b: [null, 2, null] })).toEqual([1, 2, 99]);
    // A list fallback EXTENDS the result; a bare number broadcasts without extending.
    expect(ev("COALESCE(a, b)", { a: [1], b: [null, 7] })).toEqual([1, 7]);
    expect(ev("COALESCE(a, 5)", { a: [1, null] })).toEqual([1, 5]);
  });

  it("SHUFFLE is a permutation — volatile, like the RAND already in the language", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = ev("SHUFFLE(x)", { x }) as number[];
    expect([...out].sort((a, b) => a - b)).toEqual(x);   // same multiset
    expect(out.length).toBe(x.length);
    // Volatile means two evaluations may differ; over enough draws they must. This is
    // the ONE Tier 3 function that can't assert node-equals-formula, because the two
    // deliberately run different volatility clocks — the node holds its keys until the
    // next recalc, a formula redraws per evaluation. They share `shuffleList`, so the
    // permutation itself is still one implementation.
    const draws = new Set(Array.from({ length: 40 }, () => JSON.stringify(ev("SHUFFLE(x)", { x }))));
    expect(draws.size).toBeGreaterThan(1);
  });

  it("RANGE and CONCATLISTS", () => {
    expect(ev("RANGE(0, 5)")).toEqual(new SeriesNode({ op: "range" }).data({ start: [0], stop: [5] }).list);
    expect(ev("RANGE(0, 10, 3)")).toEqual([0, 3, 6, 9]);
    const cat = new ConcatListsNode();
    const keys = cat.valueInputKeys();
    expect(ev("CONCATLISTS(a, b)", { a: [1, 2], b: [3] }))
      .toEqual(cat.data({ [keys[0]]: [[1, 2]], [keys[1]]: [[3]] }).result);
  });
});

describe("the formula namespace stays unambiguous", () => {
  // formulaNaming 2(a) is not INJECTIVE, and nothing checked that until it bit: Fill's
  // "Interpolate" op and the INTERPOLATE node in stats.ts both despace to the same
  // name. Fill's op now declares FILLINTERPOLATE instead. This is the guard — two
  // different things must never claim one formula name.
  function leaves(entries: CatalogEntry[], out: NodeCatalogEntry[] = []): NodeCatalogEntry[] {
    for (const e of entries) {
      if (e.type === "category" || e.type === "pair") leaves((e as { children: CatalogEntry[] }).children, out);
      else out.push(e as NodeCatalogEntry);
    }
    return out;
  }

  it("no two catalog leaves despace to the same formula name", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const leaf of leaves(buildCatalog(false))) {
      if (leaf.hidden) continue;
      const fx = parityDespace(leaf.label);
      const prev = seen.get(fx);
      if (prev && prev !== leaf.label) clashes.push(`${fx}: "${prev}" vs "${leaf.label}"`);
      else seen.set(fx, leaf.label);
    }
    expect(clashes, `Two leaves claim one formula name:\n  ${clashes.join("\n  ")}`).toEqual([]);
  });

  it("every declared `fx` is distinct from every other, and from the despaced labels", () => {
    const labelNames = new Set(
      leaves(buildCatalog(false)).filter((l) => !l.hidden).map((l) => parityDespace(l.label)),
    );
    const declared = [
      ...Object.values(SET_OP_META).map((m) => m.fx),
      ...Object.values(SET_RELATION_META).map((m) => m.fx),
      ...Object.values(FILL_OP_META).map((m) => m.fx),
    ];
    expect(new Set(declared).size, "duplicate `fx` among the declared names").toBe(declared.length);
    // FILLINTERPOLATE exists precisely because "Interpolate" collided with the node.
    for (const fx of declared) {
      expect(labelNames.has(fx), `${fx} collides with a node label`).toBe(false);
    }
  });

  it("TEXTFILTER — one name, the condition is an argument (the reclassified family)", () => {
    // Text Filter went operation → argument (its ops are a filter CONDITION, and
    // "Contains" despaced onto the list-membership CONTAINS). One registration,
    // same kernel as the node.
    const strings = ["alpha", "beta", "alphabet"];
    for (const op of ["contains", "not_contains", "starts_with", "ends_with"] as const) {
      const node = new TextFilterNode({ op });
      node.stringLiterals.pattern = "alp";
      expect(ev(`TEXTFILTER(x, "alp", "${op}")`, { x: strings }), op)
        .toEqual(node.data({ strings: [strings] }).result);
    }
    expect(ev('TEXTFILTER(x, "alp")', { x: strings })).toEqual(["alpha", "alphabet"]); // default contains
    expect(ev('TEXTFILTER(x, "alp", "not contains")', { x: strings })).toEqual(["beta"]); // spaced spelling
    const bad = ev('TEXTFILTER(x, "a", "fuzzy")', { x: strings });
    expect((bad as { code?: string }).code).toBe("#VALUE!");
  });

  it("uniqueNameMap full sweep — every operation-kind op name is unique across families and leaves", () => {
    // The complete naming-side check (closes rules.md known-violation 3): every
    // OPERATION-kind op in NODE_OPS claims a formula name (`fx` ?? despaced
    // label). Those names must be injective — across families, and against the
    // catalog leaves — because the parity walk counts a leaf covered when its
    // ops' names dispatch, silently assuming the dispatch IS the op. Argument-
    // kind ops take no names (their host does), and kind-only families surface
    // their ops AS leaves, which the leaf-uniqueness test above already sweeps —
    // together the two tests cover both surfaces an op name can appear on.
    //
    // A leaf may legitimately share an op's name when it IS that op (leafOps —
    // the leaf constructs the family at that op); anything else is two things
    // claiming one name.
    const CROSS_FAMILY_OK = new Set([
      // chart + sparkline share a STYLE vocabulary (Line, Column…): the ops are
      // figure styles on sink nodes that never register formula names, and the
      // shared words are the point (a sparkline Line IS a small line chart).
      "LINE", "COLUMN",
    ]);
    const opOwners = new Map<string, string>();
    const leafByName = new Map<string, NodeCatalogEntry[]>();
    for (const leaf of leaves(buildCatalog(false)).filter((l) => !l.hidden)) {
      const n = parityDespace(leaf.label);
      if (!leafByName.has(n)) leafByName.set(n, []);
      leafByName.get(n)!.push(leaf);
    }
    const clashes: string[] = [];
    for (const decl of NODE_OPS) {
      if (decl.kind !== "operation" || !decl.ops) continue;
      for (const op of decl.ops) {
        const name = op.fx ?? parityDespace(op.label);
        const id = `${decl.type}/${op.op}`;
        const prev = opOwners.get(name);
        if (prev && !CROSS_FAMILY_OK.has(name)) clashes.push(`${name}: op ${prev} vs op ${id}`);
        opOwners.set(name, id);
        for (const leaf of leafByName.get(name) ?? []) {
          let sameThing = false;
          try {
            const inst = leaf.create();
            sameThing = inst instanceof decl.ctor && (inst as { op?: unknown }).op === op.op;
          } catch { /* construction failed → not the same thing */ }
          if (!sameThing) clashes.push(`${name}: leaf "${leaf.label}" (${leaf.type}) vs op ${id}`);
        }
      }
    }
    expect(clashes, `Two different things claim one formula name (uniqueNameMap):\n  ${clashes.join("\n  ")}`).toEqual([]);
  });
});
