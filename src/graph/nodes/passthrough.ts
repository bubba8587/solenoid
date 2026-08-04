import type { SocketDataType } from "../sockets";
import type { Shape } from "../frameShape";

// The ONE declaration every passthrough consumer reads (trueany adoption, unit flow,
// the display walk, the Conduit trace). Duck-typed: this module imports no node classes.

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
  /** The ONE input passed RIGHT NOW, or null when indeterminate. Units follow it;
   *  static TYPE adoption can't and uses `combine` instead. */
  selected?: () => string | null;
  /** Unchanged byte-for-byte, so a run of these carries an FC's format lock across the
   *  whole segment. A selector is NOT pure. */
  pure?: boolean;
  /** EXTRACTION only: the element family survives but the RANK doesn't, so without this
   *  the output would parrot the container's type. Omit for a true passthrough. */
  project?: (t: SocketDataType, ctx: ProjectContext) => SocketDataType;
}

/** What a `project` may consult beyond the socket type — a FRAME's family is per-column,
 *  so it needs the shape. Injected, so this module imports no editor and no node classes. */
export interface ProjectContext {
  /** Null when it isn't a frame or can't be known without running the graph. */
  shapeOf: (inputKey: string) => Shape | null;
  /** A projection may only trust the node's own literal while the socket is UNWIRED —
   *  a cable's runtime value wins in `data()` and isn't knowable here. */
  wired: (inputKey: string) => boolean;
}

/** Nothing statically known — a projection falls back to the socket type alone. */
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

/** Pure = forwarded byte-for-byte, so a format lock reaches across a run of them. */
export function isPurePassthroughNode(n: unknown): boolean {
  return getPassthrough(n).some((s) => s.pure);
}

/** The passthrough spec producing a given output, if any. */
export function passthroughForOutput(n: unknown, outKey: string): PassthroughSpec | undefined {
  return getPassthrough(n).find((s) => s.output === outKey);
}

/** Union across outputs — the unit resolver's "which inputs carry the value" set. */
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

/** Static (connect-time), so it never consults `selected()`; `agree` is injected so
 *  trueAnyAdopt owns the one "all wired branches must match" rule. */
export function resolvePassthroughType(
  spec: PassthroughSpec,
  typeOf: (key: string) => SocketDataType | null,
  agree: (types: (SocketDataType | null)[]) => SocketDataType,
  ctx: ProjectContext = BLIND_PROJECT_CONTEXT,
): SocketDataType {
  const t = resolveForwardedType(spec, typeOf, agree);
  return spec.project ? spec.project(t, ctx) : t;
}

/** Branch encoding: `null` = UNWIRED (doesn't vote); `"trueany"` = wired but statically
 *  unknowable, which VETOES, since a typed agreement would format the value wrongly.
 *  Lives here so the socket pass and the display walk can't diverge. */
export function agreeTypes(types: Array<SocketDataType | null>): SocketDataType {
  if (types.some((t) => t === "trueany")) return "trueany";
  const wired = types.filter((t): t is SocketDataType => t !== null);
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
