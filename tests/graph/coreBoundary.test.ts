// [[C130]] rustCore, [[D99]] rustIsSpec, [[C10]] socketLattice, [[C24]] arraySemantics, [[E9]] errorsKeepOrigin
// The input boundary's frozen answers (fixtures/core/boundary-*.json.gz): what a value arriving on each rung reaches
// `data()` as, under full coercion, element coercion alone (`noWidenInputs`) and with its units kept or stripped; the
// typed list literals; the guard's origin tagging of what a node answers and its reading of what a node throws.
import { describe, expect, it } from "vitest";
import { frozen, replay } from "./coreFixtures";
import { GraphNode, GraphInput, GraphOutput } from "../../src/graph/graphModel";
import { SolenoidSocket, type SocketDataType } from "../../src/graph/sockets";
import { isSolError, solError } from "../../src/graph/errorValue";
import { ShapeError } from "../../src/graph/nodes/coerce";
import { frameFromRows, toCube } from "../../src/graph/frame";
import { matrixUnitOf, withMatrixUnit, type ColumnUnit } from "../../src/graph/unitValue";
import { cx } from "../../src/graph/cxValue";
import { computeAlone } from "./boundaryKit";

const RUNGS: SocketDataType[] = [
  "number", "list", "numlist", "string", "strlist", "strcombo", "date", "datelist", "datecombo",
  "complex", "complexlist", "complexcombo", "complextable", "logical", "logicallist", "logicalcombo", "logicaltable",
  "table", "strtable", "datetable", "anytable", "anylist", "anydata", "anycombo", "frame", "cube",
  "lambda", "chart", "document", "any", "trueany",
];

/** A value as plain JSON-able data: errors with their origin, a table's unit tag beside its cells. */
export function describe_(v: unknown): unknown {
  if (isSolError(v)) return { "#err": v.code, msg: v.message, ...(v.origin ? { origin: { ...v.origin } } : {}) };
  if (Array.isArray(v)) {
    const cells = v.map(describe_);
    const unit = matrixUnitOf(v);
    return unit ? { "#arr": cells, unit } : cells;
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, describe_(x)]));
  return v;
}

function undescribe(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(undescribe);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["#err"] === "string") {
      const e = solError(o["#err"] as never, String(o.msg));
      return o.origin ? { ...e, origin: o.origin } : e;
    }
    if (Array.isArray(o["#arr"])) return withMatrixUnit((o["#arr"] as unknown[]).map(undescribe), o.unit as ColumnUnit);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, undescribe(x)]));
  }
  return v;
}

const km = (value: number) => ({ __unitCell: true as const, value, dim: { length: 1 }, display: "km" });
const usd = (value: number) => ({ __unitCell: true as const, value, dim: { currency: 1 }, display: "usd" });
const bare = (value: number) => ({ __unitCell: true as const, value, dim: { time: 1 } });
const meters: ColumnUnit = { dim: { length: 1 }, display: "m" } as ColumnUnit;

function corpus(): unknown[] {
  const err = solError("#DIV/0!", "Divided by zero");
  const scalars: unknown[] = [0, 1, -0, 2.5, -7, NaN, Infinity, 45000, true, false, "", "abc", "12", " 3 ", null, cx(1, 2), km(5000), usd(5), bare(3), err];
  const lists: unknown[] = [
    [], [1], [0], [true], [false], ["a"], [null], [NaN], [cx(0, 1)], [km(1000)], [err],
    [1, 2, 3], [true, false, true], ["a", "b"], [1, "a", true, null], [1, err, 3], [1, NaN, 0], [cx(1, 1), 2],
    [km(1000), km(2000)], [km(1000), 3], [45000, 45001],
    [[1]], [["x"]], [[true]], [[km(1000)]], [[1, 2, 3]], [[1], [2], [3]], [[1, 2], [3, 4]], [[1, 2], [3]], [[1, 2], 3],
    [[true, false], [0, 1]], [["a", 1], [true, null]], [[1, [2, 3]]], [[]], [[], []], [[err, 1], [2, 3]],
    withMatrixUnit([[1, 2], [3, 4]], meters), withMatrixUnit([[5]], meters), withMatrixUnit([1, 2], meters),
  ];
  const frames: unknown[] = [frameFromRows([[1, "a"], [2, "b"]]), frameFromRows([[true]]), toCube([[1, 2], [3, 4]])];
  return [...scalars, ...lists, ...frames];
}

type Arrival = { rung: SocketDataType; mode: "full" | "nowiden" | "raw"; keep: boolean; v: unknown; want: unknown };
type Literal = { rung: SocketDataType; text: string; numlist: boolean; want: unknown };
type Answered = { v: unknown; want: unknown };
type Thrown = { kind: string; async: boolean; want: unknown };

class ProbeNode extends GraphNode {
  rawInputs?: Set<string>;
  noWidenInputs?: Set<string>;
  unitAware?: boolean;
  stringLiterals?: Record<string, string>;
  answer: (inputs: Record<string, unknown[]>) => unknown = (inputs) => ({ out: inputs.a });
  constructor(rung: SocketDataType) {
    super("Probe");
    this.addInput("a", new GraphInput(new SolenoidSocket(rung), "a"));
    this.addOutput("out", new GraphOutput(new SolenoidSocket("trueany"), "out"));
  }
  data(inputs: Record<string, unknown[]>): unknown {
    return this.answer(inputs);
  }
}

/** What the probe's `out` came back as: the coerced value (and whether it is the very value sent), or the error the
 *  guard sent out. */
function arrivalOf(out: Record<string, unknown>, v: unknown): unknown {
  const o = out.out;
  if (isSolError(o)) return { error: o.code, msg: o.message };
  const got = (o as unknown[] | undefined)?.[0];
  return { val: describe_(got), same: got === v && typeof v === "object" && v !== null };
}

async function arrive(c: Arrival): Promise<unknown> {
  const n = new ProbeNode(c.rung);
  n.id = "probe";
  const v = undescribe(c.v);
  if (c.mode === "raw") n.rawInputs = new Set(["a"]);
  if (c.mode === "nowiden") n.noWidenInputs = new Set(["a"]);
  if (c.keep) n.unitAware = true;
  return arrivalOf(await computeAlone(n, { a: [v] }), v);
}

const THROWS: Record<string, () => unknown> = {
  solError: () => solError("#N/A", "nothing found"),
  shape: () => new ShapeError("Expected a single value, got 3"),
  error: () => new Error("boom"),
  typeError: () => new TypeError("x is not a function"),
  string: () => "plain text",
  number: () => 42,
  object: () => ({ message: "an object" }),
  nullish: () => null,
};
/** Kinds that answer rather than throw: `nothing` answers undefined, at once or resolved. */
const ANSWERS: Record<string, () => unknown> = { nothing: () => undefined };

describe("the input boundary's frozen answers", () => {
  it("arrival: every rung, coerced, element-coerced and raw, units kept and stripped", async () => {
    const values = corpus().map(describe_);
    const cases = frozen<Arrival>("boundary-arrival", () => {
      const out: Arrival[] = [];
      for (const rung of RUNGS) for (const mode of ["full", "nowiden"] as const) for (const keep of [false, true]) for (const v of values) out.push({ rung, mode, keep, v, want: null });
      for (const keep of [false, true]) for (const v of values) out.push({ rung: "number", mode: "raw", keep, v, want: null });
      return out;
    });
    const got = new Map<Arrival, unknown>();
    for (const c of cases) got.set(c, await arrive(c));
    expect(replay("boundary-arrival", cases, (c) => got.get(c))).toEqual([]);
  });

  it("typed list literals on an unwired input", async () => {
    const texts = ["1, 2, 3", "a, \"b, c\", ", "true, no, YES, 0", "2026-03-04, 03-Apr-2026, 02-03-2026", "  ", "x,,y", "1e3, -0, abc"];
    const cases = frozen<Literal>("boundary-literals", () => {
      const out: Literal[] = [];
      for (const rung of ["strlist", "datelist", "logicallist", "numlist", "list"] as SocketDataType[]) for (const numlist of [false, true]) for (const text of texts) out.push({ rung, text, numlist, want: null });
      return out;
    });
    const got = new Map<Literal, unknown>();
    for (const c of cases) {
      const n = new ProbeNode(c.rung);
      n.stringLiterals = c.numlist ? { a: c.text } : { b: c.text, ...(c.rung === "numlist" ? {} : { a: c.text }) };
      const out = await computeAlone(n, {});
      got.set(c, { val: describe_(out.out) });
    }
    expect(replay("boundary-literals", cases, (c) => got.get(c))).toEqual([]);
  });

  it("origin tagging: an untagged error a node answers gets the node as its origin", async () => {
    const values = [...corpus(), [solError("#N/A", "a"), solError("#N/A", "a")], { ...solError("#REF!", "gone"), origin: { nodeId: "x", nodeName: "X" } }]
      .map(describe_);
    const cases = frozen<Answered>("boundary-origins", () => values.map((v) => ({ v, want: null })));
    const got = new Map<Answered, unknown>();
    for (const c of cases) {
      const n = new ProbeNode("number");
      n.id = "probe";
      const v = undescribe(c.v);
      n.answer = () => ({ out: v });
      const out = await computeAlone(n, {});
      got.set(c, { val: describe_(out.out), same: out.out === v });
    }
    expect(replay("boundary-origins", cases, (c) => got.get(c))).toEqual([]);
  });

  it("a throw, a rejection or an answer of nothing becomes the guard's error", async () => {
    const cases = frozen<Thrown>("boundary-thrown", () => [...Object.keys(THROWS), ...Object.keys(ANSWERS)].flatMap((kind) => [false, true].map((async) => ({ kind, async, want: null }))));
    const got = new Map<Thrown, unknown>();
    for (const c of cases) {
      const n = new ProbeNode("number");
      n.id = "probe";
      n.answer = () => {
        if (c.kind in ANSWERS) return c.async ? Promise.resolve(ANSWERS[c.kind]()) : ANSWERS[c.kind]();
        const t = THROWS[c.kind]();
        if (c.async) return Promise.reject(t);
        throw t;
      };
      const out = await computeAlone(n, {});
      got.set(c, describe_(out.out));
    }
    expect(replay("boundary-thrown", cases, (c) => got.get(c))).toEqual([]);
  });
});
