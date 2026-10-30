// [[C130]] rustCore, [[D99]] rustIsSpec
// A verb's static output shape (fixtures/core/shapes.json.gz): what each table verb answers for a frame of a given
// shape before any data flows, the columns a picker offers downstream and the type a passthrough projects. Each case is
// an op, a join or an append over shapes; the answer is the shape or the error code.
import { describe, expect, it } from "vitest";
import { frozen, replay } from "./coreFixtures";
import { shapeOf, shapeOfJoin, shapeOfAppend, shapeOfAddIndex, shapeOfSplitColumn, type Shape } from "../../src/graph/frameShape";
import type { FrameOp, JoinOpts, WindowFn, AggOp } from "../../src/graph/frameOps";
import { isSolError } from "../../src/graph/errorValue";

const A: Shape = { columns: [
  { name: "id", type: "number" }, { name: "name", type: "string" }, { name: "due", type: "date" },
  { name: "ok", type: "logical" }, { name: "amt", type: "number" },
] };
const B: Shape = { columns: [{ name: "id", type: "number" }, { name: "name", type: "string" }, { name: "qty", type: "number" }] };
const C: Shape = { columns: [{ name: "id", type: "string" }, { name: "note", type: "string" }] };
const E: Shape = { columns: [] };

type Case =
  | { kind: "op"; input: Shape; op: FrameOp; want?: unknown }
  | { kind: "join"; left: Shape; right: Shape; opts: JoinOpts; want?: unknown }
  | { kind: "append"; shapes: Shape[]; want?: unknown };

function ops(): FrameOp[] {
  const out: FrameOp[] = [
    { kind: "select", columns: ["name", "amt"] }, { kind: "select", columns: ["name", "name"] }, { kind: "select", columns: ["nope"] },
    { kind: "select", columns: [] }, { kind: "drop", columns: ["ok"] }, { kind: "drop", columns: ["nope"] },
    { kind: "rename", map: { name: "amt" } }, { kind: "rename", map: { id: "ID", due: "When" } }, { kind: "rename", map: { nope: "x" } },
    { kind: "sort", by: "amt", dir: "asc" }, { kind: "distinct" }, { kind: "head", n: 3 },
    { kind: "filter", column: "amt", op: "notblank", value: null }, { kind: "sliceRows", mode: "first", n: 2 }, { kind: "dropBlankRows", mode: "all" },
    { kind: "addIndex", name: "Index", start: 1 }, { kind: "addIndex", name: "id", start: 1 }, { kind: "addIndex", name: "  ", start: 0 },
    { kind: "splitColumn", column: "name", delimiter: "," }, { kind: "splitColumn", column: "name", delimiter: "" }, { kind: "splitColumn", column: "nope", delimiter: "," },
    { kind: "mergeColumns", columns: ["name", "ok"], separator: "", name: "Merged" }, { kind: "mergeColumns", columns: ["ok", "name"], separator: "-", name: "id" },
    { kind: "mergeColumns", columns: ["name"], separator: "", name: "M" }, { kind: "mergeColumns", columns: ["name", "nope"], separator: "", name: "M" },
    { kind: "fillBlanks", columns: ["amt"], dir: "down" }, { kind: "fillBlanks", columns: ["nope"], dir: "up" },
    { kind: "replaceValues", column: "name", find: "a", replaceWith: "b", mode: "cell" }, { kind: "replaceValues", column: "nope", find: "a", replaceWith: "b", mode: "cell" },
    { kind: "replaceValues", column: " ", find: "a", replaceWith: "b", mode: "substring" },
    { kind: "unpivot", idColumns: ["id"], valueColumns: ["amt", "ok"] }, { kind: "unpivot", idColumns: [], valueColumns: ["due"] },
    { kind: "unpivot", idColumns: ["id"], valueColumns: ["amt"], variableName: "id", valueName: "id" }, { kind: "unpivot", idColumns: ["nope"], valueColumns: ["amt"] },
  ];
  const aggs: AggOp[] = ["sum", "avg", "min", "max", "count", "median", "mode", "stdev", "percentof"];
  for (const op of aggs) {
    out.push({ kind: "groupBy", keys: ["name"], aggs: [{ column: "amt", op, as: "amt" }] });
    out.push({ kind: "groupBy", keys: ["name", "ok"], aggs: [{ column: "due", op, as: "name" }] });
  }
  out.push({ kind: "groupBy", keys: ["nope"], aggs: [{ column: "amt", op: "sum", as: "amt" }] }, { kind: "groupBy", keys: [], aggs: [] });
  for (const depth of [0, 1, 2]) {
    out.push({ kind: "pivot", rowFields: ["name", "ok"], colFields: ["due"], values: ["amt"], funcs: ["sum"], rowTotalDepth: depth });
  }
  out.push({ kind: "pivot", rowFields: [], colFields: ["name"], values: ["amt"], funcs: ["sum"] }, { kind: "pivot", rowFields: ["name"], colFields: [], values: [], funcs: [] });
  const fns: WindowFn[] = ["row_number", "rank", "cumsum", "lag", "lead", "first", "last", "share", "rolling_avg", "group_max"];
  for (const fn of fns) {
    out.push({ kind: "window", partitionBy: ["name"], orderBy: "due", fn, column: "amt", as: "w" });
    out.push({ kind: "window", partitionBy: [], fn, column: "due", as: "amt" });
  }
  out.push({ kind: "window", partitionBy: ["nope"], fn: "rank", as: "" });
  return out;
}

function answer(c: Case): unknown {
  try {
    if (c.kind === "op") {
      if (c.op.kind === "addIndex") return shapeOfAddIndex(c.input, c.op.name);
      if (c.op.kind === "splitColumn") return shapeOfSplitColumn(c.input, c.op.column, c.op.delimiter);
      return shapeOf(c.op, c.input);
    }
    if (c.kind === "join") return shapeOfJoin(c.left, c.right, c.opts);
    return shapeOfAppend(c.shapes);
  } catch (e) {
    return { error: isSolError(e) ? e.code : String(e) };
  }
}

describe("a verb's static output shape holds to its frozen answers", () => {
  const cases = frozen<Case>("shapes", () => {
    const out: Case[] = [];
    for (const input of [A, B, E]) for (const op of ops()) out.push({ kind: "op", input, op });
    for (const how of ["inner", "left", "outer", "semi", "anti", "cross"] as const) {
      out.push({ kind: "join", left: A, right: B, opts: { leftKey: "id", rightKey: "id", how } });
      out.push({ kind: "join", left: A, right: C, opts: { leftKey: "name", rightKey: "id", how } });
      out.push({ kind: "join", left: B, right: A, opts: { leftKey: "nope", rightKey: "id", how } });
    }
    out.push({ kind: "append", shapes: [A, B] }, { kind: "append", shapes: [B, C] }, { kind: "append", shapes: [A] }, { kind: "append", shapes: [E, B] });
    return out;
  });

  it("every op, join and append", () => {
    expect(cases.length).toBeGreaterThan(150);
    expect(replay("shapes", cases as (Case & { want: unknown })[], answer)).toEqual([]);
  });
});
