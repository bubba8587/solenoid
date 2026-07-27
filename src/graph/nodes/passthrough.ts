import type { SocketDataType } from "../sockets";
import type { Shape } from "../frameShape";

// ─── The passthrough declaration — ONE source of truth ─────────────────────────
// A "passthrough" node forwards a value from an input to an output unchanged: a
// selector picks a branch (IF/CHOOSE/SWITCH/IFS/IFERROR, Cable Switch), a pure
// passthrough carries it straight through (Display, Expect), and an element-agnostic
// op reshapes it without touching its element type (Reverse, TRANSPOSE, …).
//
// Every one of those used to be re-declared in FOUR places that each cared about
// "what flows to my output": trueany TYPE adoption (a hardcoded `instanceof` chain
// in trueAnyAdopt.ts), UNIT passthrough (the `passesUnitThrough` / `unitPassInputs`
// / `selectedUnitInput` duck markers in unitFlow.ts), the type-default DISPLAY walk,
// and the Conduit trace. Same per-node fact, four copies → drift (Expect / Cable
// Switch / IFERROR passed TYPE but not UNITS, silently). A node now declares it ONCE
// via `passthrough()`, and every consumer reads THIS. Adding a type-agnostic node is a
// one-method declaration; the resolvers need no edit. (Duck-typed on purpose — this
// module imports no node classes, so trueAnyAdopt / unitFlow stay class-agnostic.)

export type CombineMode =
  | "single" // one input forwarded unchanged (Display, Expect, Reverse, TRANSPOSE)
  | "agree"  // the common type/annotation of the wired branches, else neutral (IF, CHOOSE…)
  | "active"; // exactly the branch at activeIndex() (Cable Switch, One mode)

export interface PassthroughSpec {
  /** The output socket key whose value/type/unit is forwarded. */
  output: string;
  /** The value-branch input keys feeding it (only the value branches — NOT a
   *  selector's condition, NOT Expect's min/max/pattern). */
  inputs: string[];
  combine: CombineMode;
  /** For `active`: the index into `inputs` currently selected. */
  activeIndex?: () => number;
  /** Data-aware: the ONE input key the node is passing RIGHT NOW (IF's chosen branch
   *  from its condition), or null when indeterminate (a list condition picks per
   *  element). Units follow this when present; static TYPE adoption ignores it (it
   *  can't know a runtime branch — it uses `combine` instead). Optional. */
  selected?: () => string | null;
  /** PURE: the value flows straight through unchanged (Display / Expect), so a run of
   *  these carries a downstream FC's format lock across the whole segment. A selector
   *  is NOT pure — its output is one of several possible values. */
  pure?: boolean;
  /** Reshape the forwarded type for an EXTRACTION — a node that forwards a value out
   *  of its input's container rather than the container itself, so the element family
   *  survives but the RANK doesn't (INDEX: one cell, or a whole axis, decided at
   *  runtime). Without it the output would parrot the container's type and refuse the
   *  scalar input the extracted cell belongs in. Omit for a true passthrough. */
  project?: (t: SocketDataType, ctx: ProjectContext) => SocketDataType;
}

/** What a `project` may consult BEYOND the forwarded socket type. A homogeneous
 *  container (list, matrix) fixes its element family in its socket, so `t` alone is
 *  enough; a FRAME doesn't — its family is per-column, so the projection has to read
 *  the static column shape flowing in plus the node's own column selection. Both are
 *  supplied here rather than reached for directly, so this module still imports no
 *  editor and no node classes. */
export interface ProjectContext {
  /** The static frame Shape arriving on a named INPUT, or null when it isn't a frame
   *  or can't be known without running the graph (a CSV / Web Source, a wired-in
   *  dynamic config). Same walk — and same "unknown" convention — as the Cable
   *  Inspector's shape row. */
  shapeOf: (inputKey: string) => Shape | null;
  /** Does this input carry a cable? A projection that reads one of the node's own
   *  literals may only trust it while that socket is UNWIRED — a cable's runtime
   *  value wins in `data()`, and it isn't knowable here. */
  wired: (inputKey: string) => boolean;
}

/** The degenerate context: nothing statically known. A projection falls back to
 *  whatever it can say from the socket type alone. */
export const BLIND_PROJECT_CONTEXT: ProjectContext = { shapeOf: () => null, wired: () => false };

interface HasPassthrough { passthrough(): PassthroughSpec[]; }

/** A node's passthrough declarations (empty when it isn't a passthrough). */
export function getPassthrough(n: unknown): PassthroughSpec[] {
  const f = (n as Partial<HasPassthrough> | null)?.passthrough;
  return typeof f === "function" ? f.call(n) : [];
}

export function isPassthroughNode(n: unknown): boolean {
  return getPassthrough(n).length > 0;
}

/** A PURE passthrough (Display/Expect): the value is forwarded byte-for-byte, so a
 *  format lock reaches across a run of them (unitFlow's downstream segment walk). */
export function isPurePassthroughNode(n: unknown): boolean {
  return getPassthrough(n).some((s) => s.pure);
}

/** The passthrough spec producing a given output, if any. */
export function passthroughForOutput(n: unknown, outKey: string): PassthroughSpec | undefined {
  return getPassthrough(n).find((s) => s.output === outKey);
}

/** The value-branch input keys this node forwards (union across its outputs) — the
 *  unit resolver's "which inputs carry the value" set. */
export function passInputKeys(n: unknown): string[] {
  return [...new Set(getPassthrough(n).flatMap((s) => s.inputs))];
}

/** The ONE input a node is passing RIGHT NOW, or null (indeterminate → combine), or
 *  undefined (the node tracks no runtime selection — a pure passthrough). Resolves
 *  `selected()` first, then derives from `active`; `agree`/pure return undefined. */
export function selectedPassInput(n: unknown): string | null | undefined {
  const specs = getPassthrough(n);
  if (specs.length === 0) return undefined;
  const s = specs[0];
  if (s.selected) return s.selected();
  if (s.combine === "active" && s.activeIndex) {
    const keys = s.inputs;
    if (keys.length === 0) return null;
    const i = Math.max(0, Math.min(s.activeIndex(), keys.length - 1));
    return keys[i] ?? null;
  }
  return undefined; // single / agree → no runtime pick (fall back to the input set)
}

/** Resolve the TYPE a passthrough output should adopt, given a per-input type reader.
 *  `single` = the one input's type; `active` = the selected branch; `agree` = the
 *  common type of the wired branches (else `trueany`). Static (connect-time), so it
 *  never consults `selected()`. `agree` is injected so trueAnyAdopt owns the exact
 *  "all wired branches must match" rule it already uses elsewhere. */
export function resolvePassthroughType(
  spec: PassthroughSpec,
  typeOf: (key: string) => SocketDataType | null,
  agree: (types: (SocketDataType | null)[]) => SocketDataType,
  ctx: ProjectContext = BLIND_PROJECT_CONTEXT,
): SocketDataType {
  const t = resolveForwardedType(spec, typeOf, agree);
  // An extraction reshapes the forwarded type to its own rank; a true passthrough
  // declares no `project` and forwards verbatim.
  return spec.project ? spec.project(t, ctx) : t;
}

/** The `agree` rule for a selector: every WIRED branch must agree, or the result is
 *  genuinely unknown. `trueany` on a branch means UNWIRED (an adoptive input's reverted
 *  state) and doesn't vote. Lives here, not in a caller, so the socket pass and the
 *  display walk can't apply different notions of "the branches agree" — they did until
 *  2026-07-25, and an `IF` over a date and a number rendered the number as a date. */
export function agreeTypes(types: Array<SocketDataType | null>): SocketDataType {
  const wired = types.filter((t): t is SocketDataType => t !== null && t !== "trueany");
  if (wired.length === 0) return "trueany";
  return wired.every((t) => t === wired[0]) ? wired[0] : "trueany";
}

function resolveForwardedType(
  spec: PassthroughSpec,
  typeOf: (key: string) => SocketDataType | null,
  agree: (types: (SocketDataType | null)[]) => SocketDataType,
): SocketDataType {
  if (spec.combine === "single") return typeOf(spec.inputs[0]) ?? "trueany";
  if (spec.combine === "active") {
    const keys = spec.inputs;
    if (keys.length === 0) return "trueany";
    const i = spec.activeIndex ? Math.max(0, Math.min(spec.activeIndex(), keys.length - 1)) : 0;
    return typeOf(keys[i]) ?? "trueany";
  }
  return agree(spec.inputs.map(typeOf));
}
