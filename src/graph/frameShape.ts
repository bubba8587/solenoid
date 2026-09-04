// The static sibling of frameVerbs.ts: a Shape's columns must be exactly what a real
// preview() reports. Nest/Unnest and Frame Lookup are out — not frame shapes at all.
import { makeHeaders, type FrameColType, type FrameValue } from "./frame";
import { solError } from "./errorValue";
import type { FrameSchemaColumn } from "./frameBackend";
import type { FrameOp, JoinOpts } from "./frameVerbs";

export type ShapeColumn = FrameSchemaColumn;

export interface Shape {
  columns: ShapeColumn[];
  /** The OUTPUT column count depends on the DATA: `columns` lists what is known
   *  ahead of running, and more may appear at compute time. Absent = exact. */
  dynamic?: boolean;
}

/** A literal frame's shape (Frame Input, or any already-materialized FrameValue). */
export function shapeOfFrameValue(f: FrameValue): Shape {
  return { columns: f.columns.map((c) => ({ name: c.name, type: c.type })) };
}

/** A zero-row frame of this shape: lets a producer whose columns never depend on ROW data
 *  declare its shape by running its OWN verb, instead of a second mirror of it that can drift. */
export function emptyFrameOf(shape: Shape): FrameValue {
  return { __frame: true, columns: shape.columns.map((c) => ({ name: c.name, type: c.type, values: [] })) };
}

function requireCol(s: Shape, name: string): ShapeColumn {
  const col = s.columns.find((c) => c.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

/** One arm per `FrameOp` member, mirroring `applyVerb`'s switch kind for kind. */
export function shapeOf(op: FrameOp, input: Shape): Shape {
  switch (op.kind) {
    case "select": {
      const seen = new Set<string>();
      const wanted = op.columns.filter((n) => !seen.has(n) && (seen.add(n), true));
      return { columns: wanted.map((n) => requireCol(input, n)) };
    }
    case "drop": {
      const remove = new Set(op.columns);
      return { columns: input.columns.filter((c) => !remove.has(c.name)) };
    }
    case "rename": {
      const proposed = input.columns.map((c) => op.map[c.name] ?? c.name);
      const unique = makeHeaders(proposed, proposed.length);
      return { columns: input.columns.map((c, i) => ({ ...c, name: unique[i] })) };
    }
    // Row-only ops: the column set never changes.
    case "sort":
    case "distinct":
    case "head":
    case "filter":
    case "filterMulti":
    case "sliceRows":
      return input;
    // Cell-rewriting ops keep the column set and types; an unknown target column is #REF!.
    case "fillBlanks":
      for (const c of op.columns) requireCol(input, c);
      return input;
    case "replaceValues":
      if (op.column.trim()) requireCol(input, op.column.trim());
      return input;
    case "groupBy": {
      const keyCols = op.keys.map((n) => requireCol(input, n));
      const aggCols = op.aggs.map((a) => ({ spec: a, col: requireCol(input, a.column) }));
      const keyOut: ShapeColumn[] = keyCols.map((c) => ({ name: c.name, type: c.type }));
      const aggOut: ShapeColumn[] = aggCols.map(({ spec, col }) => ({
        name: spec.as,
        // min/max preserve the SOURCE column's type; every other agg is numeric.
        type: spec.op === "min" || spec.op === "max" ? col.type : "number",
      }));
      const out = [...keyOut, ...aggOut];
      const unique = makeHeaders(out.map((c) => c.name), out.length);
      return { columns: out.map((c, i) => ({ ...c, name: unique[i] })) };
    }
    case "unpivot": {
      const idCols = op.idColumns.map((n) => requireCol(input, n));
      const valCols = op.valueColumns.map((n) => requireCol(input, n));
      const names = makeHeaders(
        [...idCols.map((c) => c.name), op.variableName ?? "variable", op.valueName ?? "value"],
        idCols.length + 2,
      );
      return {
        columns: [
          ...idCols.map((c, k) => ({ name: names[k], type: c.type })),
          { name: names[idCols.length], type: "string" as FrameColType },
          { name: names[idCols.length + 1], type: valCols[0]?.type ?? "number" },
        ],
      };
    }
    case "pivot": {
      const rowFields = op.rowFields.filter((s) => s.trim() !== "");
      const valueNames = op.values.filter((s) => s.trim() !== "");
      if (valueNames.length === 0) throw solError("#VALUE!", "PIVOTBY needs at least one value field");
      const rowCols = rowFields.map((n) => requireCol(input, n));
      const keyNames = makeHeaders(rowFields, rowFields.length);
      // The cross-tab width depends on the DATA and can't be known without running.
      return { columns: rowCols.map((c, k) => ({ name: keyNames[k], type: c.type })), dynamic: true };
    }
    case "window": {
      for (const k of op.partitionBy) requireCol(input, k);
      if (op.orderBy) requireCol(input, op.orderBy);
      const valCol = op.column ? requireCol(input, op.column) : null;
      const name = op.as.trim() || op.fn;
      // lag / lead / first / last carry the value column's type; everything else is numeric.
      const type: FrameColType = valCol && (op.fn === "lag" || op.fn === "lead" || op.fn === "first" || op.fn === "last") ? valCol.type : "number";
      return { columns: [...input.columns.filter((c) => c.name !== name), { name, type }] };
    }
  }
}

/** Binary, so it is its own entry point, not a FrameOp member; mirrors joinFrames. */
export function shapeOfJoin(left: Shape, right: Shape, opts: JoinOpts): Shape {
  requireCol(left, opts.leftKey);
  requireCol(right, opts.rightKey);
  // Semi/anti keep LEFT columns only (a filter, not a widening join).
  if (opts.how === "semi" || opts.how === "anti") {
    return { columns: left.columns.map((c) => ({ name: c.name, type: c.type })) };
  }
  const rightNonKey = right.columns.filter((c) => c.name !== opts.rightKey);
  const names = makeHeaders(
    [...left.columns.map((c) => c.name), ...rightNonKey.map((c) => c.name)],
    left.columns.length + rightNonKey.length,
  );
  const out: ShapeColumn[] = [];
  left.columns.forEach((c, ci) => out.push({ name: names[ci], type: c.type }));
  rightNonKey.forEach((c, ri) => out.push({ name: names[left.columns.length + ri], type: c.type }));
  return { columns: out };
}

/** Union by NAME; a shared name with conflicting types is a #TYPE!. */
export function shapeOfAppend(shapes: readonly Shape[]): Shape {
  const names: string[] = [];
  const typeOf = new Map<string, FrameColType>();
  for (const s of shapes) {
    for (const c of s.columns) {
      const existing = typeOf.get(c.name);
      if (existing === undefined) { typeOf.set(c.name, c.type); names.push(c.name); }
      else if (existing !== c.type) {
        throw solError("#TYPE!", `append: column "${c.name}" is ${existing} in one frame and ${c.type} in another`);
      }
    }
  }
  return { columns: names.map((name) => ({ name, type: typeOf.get(name)! })) };
}

/** Always exactly one new numeric column — fully static, no data dependency. */
export function shapeOfAddIndex(input: Shape, name: string): Shape {
  const nm = name.trim() || "Index";
  const unique = makeHeaders([nm, ...input.columns.map((c) => c.name)], 1 + input.columns.length);
  return {
    columns: [
      { name: unique[0], type: "number" },
      ...input.columns.map((c, i) => ({ name: unique[i + 1], type: c.type })),
    ],
  };
}

/** N = the max part count across ROWS, so this states only the untouched columns
 *  and flags the rest dynamic. */
export function shapeOfSplitColumn(input: Shape, column: string, delimiter: string): Shape {
  if (delimiter === "") return input;
  const idx = input.columns.findIndex((c) => c.name === column);
  if (idx < 0) throw solError("#REF!", `column "${column}" not found`);
  return { columns: input.columns.filter((_, i) => i !== idx), dynamic: true };
}
