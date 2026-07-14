// Date-aware display helpers for ValueDisplay (kept out of nodeKit.tsx so they
// stay React-free and unit-testable). The principle: a value is a DATE when the
// host node's OUTPUT SOCKET is a date type (the same isDateType signal the
// Format Controller uses) — so every date-producing node formats its serials as
// dates in its own value box, for scalars AND lists, without each node wiring up
// an ad-hoc `render` formatter.

import { getOwningEditor } from "../activeGraph";
import { SolenoidSocket, isDateType, isWildcardType, type SocketDataType } from "../sockets";
import { isPassthroughNode } from "../nodes/passthrough";
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
 *  serial carries a time fraction (e.g. NOW()) — mirrors the old per-node
 *  fmtSerial, using the canonical formatter. */
function fmtSerial(v: number): string {
  if (!Number.isFinite(v)) return "";
  const hasTime = Math.abs(v - Math.round(v)) > 1e-4;
  return formatDateSerial(v, hasTime ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATE_FORMAT);
}

/**
 * The concrete data type of the value a node DISPLAYS — the type-default display
 * principle: a value shows in its TYPE's default format wherever it appears (a
 * date reads "20-Mar-2026", not its serial), even if physically carried as a
 * number. Reads the node's primary output socket; when that's `any` AND the node
 * is a pure pass-through (Display), it resolves the type from whatever FEEDS it —
 * through a chain of pass-throughs and through a Conduit lane (whose output socket
 * now carries the real type). A non-pass-through `any` producer is left as `any`
 * (we don't guess a transform's output from its inputs). Cycle- and depth-guarded.
 */
function displayedType(
  nodeId: string,
  outKey: string | undefined,
  seen: Set<string>,
  depth: number,
): SocketDataType | undefined {
  if (depth > 32) return undefined;
  // Owning editor: an internal drill-in node's source chain lives in the internal
  // editor, not main (see getOwningEditor). The recursion re-resolves per source,
  // but a source is in the same graph so it stays consistent.
  const editor = getOwningEditor(nodeId);
  const node = editor?.getNode(nodeId) as
    (Record<string, unknown> & { outputs?: Record<string, { socket?: unknown } | undefined> }) | undefined;
  if (!node) return undefined;
  const out = outKey ? node.outputs?.[outKey] : (node.outputs?.result ?? Object.values(node.outputs ?? {})[0]);
  const sock = out?.socket;
  const dt = sock instanceof SolenoidSocket ? sock.dataType : undefined;
  if (dt && !isWildcardType(dt)) return dt; // concrete socket (a producer, or a typed Conduit lane)

  if (!isPassthroughNode(node)) return dt; // an `any` producer's output type is genuinely `any`
  const key = `${nodeId}::${outKey ?? ""}`;
  if (seen.has(key)) return dt;
  seen.add(key);
  for (const c of editor!.getConnections()) {
    if (c.target !== nodeId) continue;
    const t = displayedType(c.source, c.sourceOutput, seen, depth + 1);
    if (t && !isWildcardType(t)) return t;
  }
  return dt;
}

/**
 * Does the value this node displays carry dates? Resolves the displayed TYPE
 * (through pass-throughs / Conduit lanes — see displayedType), so a date reads as
 * a date everywhere it flows, not just at the node that produced it. Read at
 * render time, so a socket SWAP (Cast / Conduit lane retype) re-detects next render.
 */
export function nodeOutputIsDate(nodeId: string | null): boolean {
  if (!nodeId) return false;
  const t = displayedType(nodeId, undefined, new Set(), 0);
  return t !== undefined && isDateType(t);
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
