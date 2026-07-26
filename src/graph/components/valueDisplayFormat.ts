// Date-aware display helpers for ValueDisplay (kept out of nodeKit.tsx so they
// stay React-free and unit-testable). The principle: a value is a DATE when the
// host node's OUTPUT SOCKET is a date type (the same isDateType signal the
// Format Controller uses) — so every date-producing node formats its serials as
// dates in its own value box, for scalars AND lists, without each node wiring up
// an ad-hoc `render` formatter.

import { getOwningEditor } from "../activeGraph";
import { SolenoidSocket, isDateType, elementFamilyOf, type SocketDataType } from "../sockets";
import type { ElemFamily } from "./ArrayChip";
import { formatDateSerial, DEFAULT_DATE_FORMAT, DEFAULT_DATETIME_FORMAT } from "../nodes/date";
import { isSolError, type SolError } from "../errorValue";
import { isUnitCell, formatUnitCell, type UnitCell } from "../unitValue";
import { fcUnitToUnit } from "../unitBridge";
import { dimEqual } from "../dimension";
import { formatScalar } from "./format";
import { formatNumberWithAnnotation, type FormatAnnotation } from "../formatAnnotationStore";

// Lists may now carry `null` (missing) and per-cell `SolError` as distinct kinds
// (the relaxed array-semantics model — see dev-notes "Array-semantics policy
// DECISIONS"). A scalar is still number | string | SolError | null.
export type DisplayValue =
  | number
  | UnitCell
  | (number | UnitCell | null | SolError)[]
  | (number | null | SolError)[]
  | string
  | (string | null)[]
  | boolean
  | (boolean | null)[]
  // A mixed 1-D list (e.g. IF over a list with null propagation) — formatListCell
  // renders every element kind, so one catch-all row covers them all.
  | (number | string | boolean | null | SolError)[]
  // 2-D (matrix) values flow to the ArrayChip; one row covers every element kind.
  | (number | string | boolean | null | SolError)[][]
  | SolError
  | null;

/** Format ONE element of a list for the value box / clipboard: a missing cell
 *  renders literally as `null`, a logical as `TRUE`/`FALSE` (Excel form), a
 *  per-cell error as its `#CODE!`, text as-is, a number via the caller's scalar
 *  formatter, a dimensioned cell as "magnitude unit" (`5 m/s`). */
export function formatListCell(v: number | string | boolean | null | SolError | UnitCell, fmtNum: (n: number) => string): string {
  if (v === null) return "null";
  if (isUnitCell(v)) return formatCellWithDisplay(v, fmtNum);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isSolError(v)) return v.code;
  if (typeof v === "string") return v;
  return fmtNum(v);
}

// ─── Unit cells for display (Bundle 05: FC A4) ───────────────────────────────────
// A value carrying a real dimension (a `UnitCell`, stored base-SI + dim) has to be
// unwrapped before the number/string branches of ValueDisplay. Two cases:
//   • an FC is docked → unwrap to the magnitude in the FC's DISPLAY unit (base → that
//     unit) so the FC formats it and appends its own label (5000 m + km FC → "5 km");
//   • no FC → render "magnitude derived-symbol" here (5000 ÷ 1000 stays base; a
//     Convert/derived value shows "5 m/s"), a plain string the text branch draws.

/** The magnitude of a dimensioned cell in the display unit of `ann` when they're
 *  commensurable, else the raw base-SI magnitude. The value-mutating FC keeps its
 *  `unit` field and the cell's `display` in sync, so an annotated box's label
 *  (ann.unit) and magnitude agree; the UNannotated case is handled by
 *  `formatCellWithDisplay` (which reads the cell's own display). */
function displayMagnitude(cell: UnitCell, ann: FormatAnnotation | undefined): number {
  const id = cell.display ?? (ann && ann.unit !== "none" && ann.unit !== "custom" ? ann.unit : undefined);
  if (id) {
    const u = fcUnitToUnit(id);
    if (u && dimEqual(u.dim, cell.dim)) return (cell.value - (u.offset ?? 0)) / u.scale;
  }
  return cell.value;
}

/** Render a dimensioned cell as "magnitude unit" using its authored `display` unit
 *  where present (`5 km`), else its derived symbol (`5 m/s`). The pure formatter
 *  (unitValue `formatUnitCell`) only knows the derived symbol, so the display layer
 *  owns the display-unit resolution (it can reach the FC unit registry). */
function formatCellWithDisplay(cell: UnitCell, fmtNum: (n: number) => string): string {
  if (cell.display) {
    const u = fcUnitToUnit(cell.display);
    if (u && dimEqual(u.dim, cell.dim)) {
      const mag = (cell.value - (u.offset ?? 0)) / u.scale;
      const ann = { format: "auto", unit: cell.display } as FormatAnnotation;
      // Reuse the annotation number+unit-affix pipeline for the label placement.
      return formatNumberWithAnnotation(mag, ann);
    }
  }
  return formatUnitCell(cell, fmtNum);
}

/** Replace any `UnitCell` in a display value with its render form (see above). A
 *  no-op when nothing is dimensioned — the overwhelming common case. */
export function unwrapUnitCells(value: DisplayValue, ann: FormatAnnotation | undefined): DisplayValue {
  if (isUnitCell(value)) {
    return ann ? displayMagnitude(value, ann) : formatCellWithDisplay(value, formatScalar);
  }
  if (Array.isArray(value) && value.some((c) => isUnitCell(c))) {
    if (ann) {
      // FC docked: unwrap every cell to its display magnitude, other kinds intact.
      return (value as (number | UnitCell | null | SolError)[]).map((c) =>
        isUnitCell(c) ? displayMagnitude(c, ann) : c) as DisplayValue;
    }
    // No FC: render each cell to its display string (units shown per cell).
    return (value as (number | UnitCell | boolean | string | null | SolError)[])
      .map((c) => formatListCell(c, formatScalar)) as unknown as DisplayValue;
  }
  return value;
}

/** Format a date serial for a value box: date only, or date + time when the
 *  serial carries a time fraction (e.g. NOW()), using the canonical formatter. */
function fmtSerial(v: number): string {
  if (!Number.isFinite(v)) return "";
  const hasTime = Math.abs(v - Math.round(v)) > 1e-4;
  return formatDateSerial(v, hasTime ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATE_FORMAT);
}

/**
 * The concrete data type of the value a node DISPLAYS — the type-default display
 * principle: a value shows in its TYPE's default format wherever it appears (a date
 * reads "20-Mar-2026", not its serial), even if physically carried as a number.
 *
 * This just READS the output socket. It used to walk the graph to re-derive the type
 * for a wildcard socket, which was a second answer to a question the ADOPTION pass
 * already answers and writes onto the socket (`reconcileTrueAnyTypes` →
 * `settleWildcardTypes`, run by `reconcileFcTypes` on every connection change and by
 * persistence on load). Two resolvers meant two rules, and they diverged: until
 * 2026-07-25 an `IF` over a date and a number rendered the number as a DATE, because
 * the walk returned the first wired branch while adoption correctly said "unknown".
 *
 * The precondition is machine-checked by `passthroughOutputMutable.test.ts`: every
 * passthrough whose output is a wildcard carries a MUTABLE socket, so adoption can and
 * does write the resolved type there. A wildcard still on the socket after adoption
 * therefore means genuinely unknown — and this honours that instead of guessing.
 */
function displayedType(nodeId: string, outKey?: string): SocketDataType | undefined {
  // Owning editor: an internal drill-in node lives in the internal editor, not main.
  const editor = getOwningEditor(nodeId);
  const node = editor?.getNode(nodeId) as
    (Record<string, unknown> & { outputs?: Record<string, { socket?: unknown } | undefined> }) | undefined;
  if (!node) return undefined;
  // `outKey` names WHICH socket to read on a multi-output card (Filter's Dropped,
  // Split Frame's Matrix/Headers); it never triggers a traversal.
  const out = outKey ? node.outputs?.[outKey] : (node.outputs?.result ?? Object.values(node.outputs ?? {})[0]);
  const sock = out?.socket;
  return sock instanceof SolenoidSocket ? sock.dataType : undefined;
}

export function nodeOutputIsDate(nodeId: string | null): boolean {
  return nodeOutputElemFamily(nodeId) === "date";
}

/**
 * The ELEMENT FAMILY the node's output socket declares (resolved through
 * pass-throughs / Conduit lanes, like nodeOutputIsDate — which is now just this
 * === "date"). `undefined` for a wildcard output or a non-family socket, where
 * the caller falls back to scanning cells.
 *
 * The socket is the TRUTH about a container's element family; the cells are not.
 * A date serial is indistinguishable from a number, and a list whose cells are
 * all `null` (every entry unparseable) can't vote at all — so a Bool List Input
 * with no valid entry left would tint and open as NUMERIC purely because nothing
 * disagreed. Anything derived from the VALUE is sniffing a display artifact; the
 * declared type is what the user picked.
 */
export function nodeOutputElemFamily(nodeId: string | null, outKey?: string): ElemFamily | undefined {
  if (!nodeId) return undefined;
  const t = displayedType(nodeId, outKey);
  if (t === undefined) return undefined;
  if (isDateType(t)) return "date"; // date routes through the one shared predicate
  const fam = elementFamilyOf(t);
  return fam === "number" || fam === "string" || fam === "logical" ? fam : undefined;
}

/**
 * Pre-format a value for display when the node's output is a date socket: a
 * numeric serial (scalar or list) becomes a date string, so it renders — and
 * chips / copies — as a date. No-op when a Format Controller annotation is
 * present (it formats dates itself), or the value isn't a plain number / number
 * list (text, errors, already-formatted strings pass through untouched). A
 * non-finite serial (a blank/failed cell) becomes "" in a list.
 */
export function dateFormatDisplay(value: DisplayValue, dateLike: boolean, hasAnnotation: boolean): DisplayValue {
  if (!dateLike || hasAnnotation) return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? fmtSerial(value) : value;
  }
  if (Array.isArray(value) && typeof value[0] === "number") {
    return (value as number[]).map((v) => (Number.isFinite(v) ? fmtSerial(v) : ""));
  }
  return value;
}

/**
 * Should a list render INLINE (joined text) rather than as a chip?
 *  • expanded Display (`full === true`) → inline, so a resized box shows the list;
 *  • a normal node with an FC annotation (`full === undefined`) → inline, so the
 *    formatting is visible (the chip can't show it);
 *  • COLLAPSED Display (`full === false`) → NEVER inline (always a chip) — the
 *    collapse-to-chip behavior must win even when an FC is docked. Non-Display
 *    nodes never pass `full`, so it's `undefined` there.
 */
export function shouldRenderListInline(full: boolean | undefined, hasAnnotation: boolean): boolean {
  return full === true || (full === undefined && hasAnnotation);
}
