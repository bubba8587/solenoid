// ─── Static frame shape ─────────────────────────────────────────────────────────
// Column names + types computed AHEAD of running anything — the static sibling of
// the relational verbs in frameVerbs.ts. Each arm mirrors the real verb's column-
// reshaping logic without touching row data, so a mismatch between this and the
// actual JS/Rust output (frameShape.test.ts) is a caught bug, not a silent
// divergence. Reuses FrameColType (sockets.ts's element-family names, via frame.ts)
// and FrameSchemaColumn (frameBackend.ts's runtime preview schema) rather than a
// new type universe — a Shape's columns are exactly what a real preview() reports.
//
// Nest/Unnest (frame ⟷ cube boundary) and Frame Lookup (scalar output) fall
// outside this module on purpose: their outputs aren't a Frame shape at all.
import { makeHeaders, type FrameColType, type FrameValue } from "./frame";
import { solError } from "./errorValue";
import type { FrameSchemaColumn } from "./frameBackend";
import type { FrameOp, JoinOpts } from "./frameVerbs";

export type ShapeColumn = FrameSchemaColumn;

export interface Shape {
  columns: ShapeColumn[];
  /** True when the verb's OUTPUT column count depends on the DATA itself (PIVOTBY's
   *  distinct column-field combinations, Split Column's max part count) — `columns`
   *  lists everything known ahead of running; more columns may appear at compute
   *  time. Absent/false = the shape is exact. */
  dynamic?: boolean;
}

/** A literal frame's shape (Frame Input, or any already-materialized FrameValue). */
export function shapeOfFrameValue(f: FrameValue): Shape {
  return { columns: f.columns.map((c) => ({ name: c.name, type: c.type })) };
}

function requireCol(s: Shape, name: string): ShapeColumn {
  const col = s.columns.find((c) => c.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

/** One arm per `FrameOp` member, mirroring `applyVerb`'s switch (frameVerbs.ts:851)
 *  kind for kind. */
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
      return input;
    case "groupBy": {
      const keyCols = op.keys.map((n) => requireCol(input, n));
      const aggCols = op.aggs.map((a) => ({ spec: a, col: requireCol(input, a.column) }));
      const keyOut: ShapeColumn[] = keyCols.map((c) => ({ name: c.name, type: c.type }));
      const aggOut: ShapeColumn[] = aggCols.map(({ spec, col }) => ({
        name: spec.as,
        // min/max preserve the SOURCE column's type; every other agg is numeric —
        // mirrors groupByFrame's aggOut (frameVerbs.ts:277-283).
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
      // Body columns (one per distinct column-field combination × value) depend on
      // the DATA — pivotFrame's cross-tab width can't be known without running it.
      return { columns: rowCols.map((c, k) => ({ name: keyNames[k], type: c.type })), dynamic: true };
    }
  }
}

/** Join (binary — its own entry point in frameVerbs.ts, like joinFrames, not a
 *  FrameOp member). Mirrors joinFrames' column assembly (frameVerbs.ts:378-428). */
export function shapeOfJoin(left: Shape, right: Shape, opts: JoinOpts): Shape {
  requireCol(left, opts.leftKey);
  requireCol(right, opts.rightKey);
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

/** Append (n-ary — union by name; a shared name with conflicting types is a
 *  #TYPE!, mirroring appendFrames, frameVerbs.ts:827-848). */
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

/** Add Index (Power Query, eager JS-only): always exactly one new numeric column —
 *  fully static, no data dependency. Mirrors addIndexColumn (frameVerbs.ts:340-348). */
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

/** Split Column (Power Query, eager JS-only): the source column is replaced by N
 *  text columns, N = the max part count across ROWS — data-dependent, so this
 *  states only what's certain (the untouched columns) and flags the rest dynamic.
 *  Mirrors splitColumn (frameVerbs.ts:322-336). */
export function shapeOfSplitColumn(input: Shape, column: string, delimiter: string): Shape {
  if (delimiter === "") return input;
  const idx = input.columns.findIndex((c) => c.name === column);
  if (idx < 0) throw solError("#REF!", `column "${column}" not found`);
  return { columns: input.columns.filter((_, i) => i !== idx), dynamic: true };
}
