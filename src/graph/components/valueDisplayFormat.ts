// Date-aware display helpers for ValueDisplay (kept out of nodeKit.tsx so they
// stay React-free and unit-testable). The principle: a value is a DATE when the
// host node's OUTPUT SOCKET is a date type (the same isDateType signal the
// Format Controller uses) — so every date-producing node formats its serials as
// dates in its own value box, for scalars AND lists, without each node wiring up
// an ad-hoc `render` formatter.

import { getEditor } from "../process";
import { SolenoidSocket, isDateType } from "../sockets";
import { formatDateSerial, DEFAULT_DATE_FORMAT, DEFAULT_DATETIME_FORMAT } from "../nodes/date";
import { isSolError, type SolError } from "../errorValue";

// Lists may now carry `null` (missing) and per-cell `SolError` as distinct kinds
// (the relaxed array-semantics model — see dev-notes "Array-semantics policy
// DECISIONS"). A scalar is still number | string | SolError | null.
export type DisplayValue =
  | number
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
 *  formatter. */
export function formatListCell(v: number | string | boolean | null | SolError, fmtNum: (n: number) => string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isSolError(v)) return v.code;
  if (typeof v === "string") return v;
  return fmtNum(v);
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
 * Does the node's primary result carry dates? Reads the live output socket
 * (conventionally `result`, else the first output) and tests isDateType. Read
 * at render time, so a socket SWAP (Cast target / polyform result type, which
 * call area.update) re-detects on the next render.
 */
export function nodeOutputIsDate(nodeId: string | null): boolean {
  if (!nodeId) return false;
  const node = getEditor()?.getNode(nodeId);
  if (!node) return false;
  const out = node.outputs?.result ?? Object.values(node.outputs ?? {})[0];
  const sock = out?.socket;
  return sock instanceof SolenoidSocket && isDateType(sock.dataType);
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
