// [[D102]] graphOnCore, [[D99]] rustIsSpec
// The lazy frame verbs through data(): a frame value is uploaded for a ref and the body plans over it, a ref is
// extended, a pass-through hands back what came in, and a Cube runs its verb on its cells. The sweep drives each
// card over its ops and settings, so the recorder freezes each body on the inputs that matter.
import { describe, it, expect, beforeEach } from "vitest";
import { ClassicPreset } from "rete";
import { wrapNodeData } from "../../src/graph/coerceInputs";
import { resetFrameBackendToJs, readFrame, uploadFrame, runFrameUnary, isFrameRef, type FrameRef } from "../../src/graph/frameBackend";
import { frameToCube, frameFromRows, cubeFromColumns, isCubeValue, type FrameValue, type CubeValue } from "../../src/graph/frame";
import { solError } from "../../src/graph/errorValue";
import { applyFcUnit } from "../../src/graph/unitBridge";
import { columnUnitFromSpec } from "../../src/graph/unitColumn";
import {
  DistinctNode, HeadNode, SortFrameNode, FilterFrameNode, ColumnsNode, GroupByFrameNode, UnpivotNode, RenameNode,
  SplitColumnNode, AddIndexNode, FillBlanksNode, ReplaceValuesNode, MergeColumnsNode, DropBlankRowsNode, WindowNode, GetColumnNode,
  HEAD_OP_META, COLUMNS_OP_META, AGG_OP_META, BLANK_ROW_OP_META, WINDOW_FN_META,
} from "../../src/graph/nodes/frame";

const sales: FrameValue = {
  __frame: true,
  columns: [
    { name: "Rep", type: "string", values: ["Ada", "Bo", "Ada", "Cy", null, "Bo"] },
    { name: "Region", type: "string", values: ["N", "S", "N", "E", "S", null] },
    { name: "Amount", type: "number", values: [100, 50, 100, 200, 75, null] },
    { name: "When", type: "date", values: [45000, 45001, 45000, null, 45004, 45005] },
    { name: "Code", type: "string", values: ["a-1", "b-2", "a-1", "c", "", "d-4-x"] },
  ],
};
const cube: CubeValue = cubeFromColumns([
  ...frameToCube(sales).columns,
  { name: "Tags", cells: [["x", "y"], [], ["x"], null, ["z"], ["y"]] },
]);

// Readings, a linear unit, mixed and error cells, logicals, nested tables and lists, for the cube verbs.
const sub0 = frameFromRows([[1], [2]], ["x"]);
const sub1 = frameFromRows([[9]], ["x"]);
const odd: CubeValue = cubeFromColumns([
  { name: "Rep", cells: ["Ada", "bo", "Ada", "Cy", "ada", null], type: "string" },
  { name: "t", cells: [20, 26, 20, null, 31, 15].map((v) => (v === null ? null : applyFcUnit(v, "degC"))) as never },
  { name: "d", cells: [1, 2, 1, 3, 2.5, 4].map((v) => applyFcUnit(v, "km")) as never },
  { name: "Mixed", cells: [1, "x", true, solError("#N/A", "gone"), NaN, -0] },
  { name: "Flag", cells: [true, false, true, null, false, true], type: "logical" },
  { name: "sub", cells: [sub0, sub1, sub0, null, sub1, sub0] },
  { name: "Tags", cells: [["Work", "home"], ["home"], ["Work", "home"], [], null, ["x"]] },
]);

// A unit column, numbers and dates as text, logicals and an error cell, for Get Column's readings.
const metered: FrameValue = {
  __frame: true,
  columns: [
    { name: "len", type: "number", values: [1.5, null, 3, NaN], unit: columnUnitFromSpec("km")! },
    { name: "txt", type: "string", values: ["12", "x", "", " 2024-01-15 "] },
    { name: "day", type: "date", values: [45000, null, 45001.5, 45002] },
    { name: "ok", type: "logical", values: [true, false, null, true] },
    { name: "bad", type: "number", values: [1, solError("#N/A", "gone"), 2, 3] },
  ],
};

// Rows equal cell by cell, a NaN apart from a blank, -0 as 0, a unit by its display: what Distinct keys on.
const dupes: CubeValue = cubeFromColumns([
  { name: "k", cells: [NaN, null, NaN, 0, -0, applyFcUnit(1, "km"), applyFcUnit(1, "km"), applyFcUnit(1000, "m")] as never },
  { name: "sub", cells: [sub0, sub0, sub0, sub1, sub1, null, null, null] },
  { name: "tags", cells: [["a"], ["a"], ["a"], [], [], ["b", "c"], ["b", "c"], ["b", "c"]] },
]);

type Card = ClassicPreset.Node & {
  data(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>>;
  stringLiterals?: Record<string, string>;
  literals?: Record<string, number>;
};

function card<T extends ClassicPreset.Node>(n: T): T & Card {
  wrapNodeData(n as never);
  return n as T & Card;
}

beforeEach(() => resetFrameBackendToJs());

describe("a lazy verb plans over refs", () => {
  it("passes a frame value through as itself", async () => {
    const n = card(new SortFrameNode());
    const out = await n.data({ frame: [sales] });
    expect(out.frame).toBe(sales);
    expect(n.cachedResult).toBe(sales);
  });

  it("passes a ref through as a new ref planning nothing more", async () => {
    const ref = await uploadFrame(sales) as FrameRef;
    const out = await card(new SortFrameNode()).data({ frame: [ref] });
    expect(isFrameRef(out.frame)).toBe(true);
    expect(out.frame).not.toBe(ref);
    expect((out.frame as FrameRef).__plan).toEqual([{ kind: "drop", columns: [] }]);
  });

  it("extends a ref's plan, its earlier ops the same objects", async () => {
    const first = (await card(new DistinctNode()).data({ frame: [sales] })).frame as FrameRef;
    const n = card(new HeadNode());
    n.literals.rows = 2;
    const out = (await n.data({ frame: [first] })).frame as FrameRef;
    expect(out.__frameRef).toBe(first.__frameRef);
    expect(out.__plan[0]).toBe(first.__plan[0]);
    expect(out.__plan[1]).toEqual({ kind: "head", n: 2 });
    const rows = await readFrame(out);
    expect((rows as FrameValue).columns[0].values).toEqual(["Ada", "Bo"]);
  });

  it("answers both of Filter's outputs, and passes a value through with nothing dropped", async () => {
    const n = card(new FilterFrameNode());
    expect(await n.data({ frame: [sales] })).toEqual({ frame: sales, dropped: null });
    n.stringLiterals.column0 = "Amount";
    n.stringLiterals.value0 = "60";
    const out = await n.data({ frame: [sales] });
    expect((await readFrame(out.frame as FrameRef) as FrameValue).columns[2].values).toEqual([100, 100, 200, 75]);
    expect((await readFrame(out.dropped as FrameRef) as FrameValue).columns[2].values).toEqual([50, null]);
  });

  it("runs a Cube's verb on its cells", async () => {
    const n = card(new HeadNode());
    n.literals.rows = 1;
    const out = await n.data({ frame: [cube] });
    expect(isCubeValue(out.frame)).toBe(true);
    expect((out.frame as CubeValue).columns.find((c) => c.name === "Tags")?.cells).toEqual([["x", "y"]]);
  });
});

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Spec = {
  make: () => ClassicPreset.Node;
  cubes?: boolean;
  fields?: Record<string, readonly unknown[]>;
  strs?: string[];
  lists?: string[];
  nums?: string[];
  anys?: string[];
  pairs?: boolean;
  frames?: () => Promise<unknown[]>;
};

const SPECS: Record<string, Spec> = {
  Distinct: { make: () => new DistinctNode(), cubes: true },
  Head: { make: () => new HeadNode(), cubes: true, fields: { op: Object.keys(HEAD_OP_META) }, nums: ["rows", "to"] },
  Sort: { make: () => new SortFrameNode(), cubes: true, fields: { dir: ["asc", "desc"] }, strs: ["column"] },
  Filter: { make: () => new FilterFrameNode(), cubes: true, fields: { combine: ["and", "or"] }, pairs: true },
  Columns: { make: () => new ColumnsNode(), cubes: true, fields: { op: Object.keys(COLUMNS_OP_META) }, lists: ["columns"] },
  GroupBy: { make: () => new GroupByFrameNode(), fields: { agg: Object.keys(AGG_OP_META).filter((k) => k !== "percentof") }, lists: ["keys"], strs: ["column"] },
  Unpivot: { make: () => new UnpivotNode(), lists: ["idColumns", "valueColumns"] },
  Rename: { make: () => new RenameNode(), lists: ["from", "to"] },
  SplitColumn: { make: () => new SplitColumnNode(), strs: ["column", "delimiter"], lists: ["into"] },
  AddIndex: { make: () => new AddIndexNode(), nums: ["start"], strs: ["name"] },
  FillBlanks: { make: () => new FillBlanksNode(), fields: { dir: ["down", "up"] }, lists: ["columns"] },
  ReplaceValues: { make: () => new ReplaceValuesNode(), fields: { mode: ["cell", "substring"] }, strs: ["column"], anys: ["find", "replace"] },
  MergeColumns: { make: () => new MergeColumnsNode(), lists: ["columns"], strs: ["separator", "name"] },
  DropBlankRows: { make: () => new DropBlankRowsNode(), fields: { mode: Object.keys(BLANK_ROW_OP_META) } },
  GetColumn: {
    make: () => new GetColumnNode(), cubes: true, fields: { readAs: ["number", "text", "date", "logical"] }, strs: ["name"],
    frames: async () => [metered, metered, await uploadFrame(metered), 7, [1, 2], [[1, "a"], [2, "b"]]],
  },
  Window: { make: () => new WindowNode(), cubes: true, fields: { agg: Object.keys(WINDOW_FN_META) }, lists: ["keys"], strs: ["orderBy", "column", "name"], nums: ["n"] },
};

const NAMES = ["Rep", "Region", "Amount", "When", "Code", "", "  Amount ", "Nope", "Tags", "2", "t", "d", "Mixed", "Flag", "sub", "len", "txt", "day", "ok", "bad", "1"];
const FILTER_OPS = ["gt", "gte", "lt", "lte", "eq", "neq", "contains", "startsWith", "endsWith", "isblank", "notblank", "iserror", "noterror", "listContains", "listContainsAny", "listContainsAll", "listEmpty"];
const VALUES: unknown[] = ["60", "Ada", "a", "", " ", "-", "x,y", "home", "work, home", "20", 100, 0, true, null];
const NUMS: unknown[] = [0, 1, 2, 3, 10, -1, 2.5, 1e9, null];

describe("every lazy verb over its ops and settings", () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    it(name, async () => {
      const r = rng(name.length * 7919);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
      const names = () => NAMES.filter(() => r() < 0.3);
      const ref = await uploadFrame(sales) as FrameRef;
      const planned = await runFrameUnary(sales, { kind: "distinct" });
      const sources: unknown[] = [sales, ref, planned, null, ...(spec.cubes ? [cube, cube, odd, odd, odd, dupes] : []), ...(await spec.frames?.() ?? [])];
      for (let i = 0; i < (spec.cubes ? 160 : 80); i++) {
        const n = spec.make() as Card & Record<string, unknown>;
        for (const [k, vs] of Object.entries(spec.fields ?? {})) n[k] = pick(vs);
        const inputs: Record<string, unknown[]> = {};
        const set = (k: string, literal: () => unknown, wired: () => unknown, num = false) => {
          const u = r();
          if (u < 0.5) {
            const v = literal();
            if (num) n.literals![k] = v as number; else n.stringLiterals![k] = v as string;
          } else if (u < 0.85) inputs[k] = [wired()];
        };
        for (const k of spec.strs ?? []) set(k, () => pick(NAMES), () => (r() < 0.15 ? null : pick(NAMES)));
        for (const k of spec.lists ?? []) set(k, () => names().join(","), () => (r() < 0.1 ? null : names()));
        for (const k of spec.nums ?? []) set(k, () => pick(NUMS.filter((x) => x !== null)), () => pick(NUMS), true);
        for (const k of spec.anys ?? []) set(k, () => String(pick(VALUES) ?? ""), () => pick(VALUES));
        if (spec.pairs) {
          const f = n as unknown as FilterFrameNode;
          if (r() < 0.4) f.addValuePair();
          for (const [ck, vk] of f.valuePairKeys()) {
            f.condConfig[ck.slice(6)] = { op: pick(FILTER_OPS) as never, matchCase: r() < 0.3 };
            set(ck, () => pick(NAMES), () => pick(NAMES));
            set(vk, () => String(pick(VALUES) ?? ""), () => pick(VALUES));
          }
        }
        const src = pick(sources);
        if (src !== null || r() < 0.5) inputs.frame = [src];
        // A plan naming a column the frame lacks fails where the card previews it, which the error guard shows.
        const out = await Promise.resolve().then(() => card(n).data(inputs)).catch((e: unknown) => ({ frame: e }));
        expect(out).toBeTypeOf("object");
      }
    });
  }
});
