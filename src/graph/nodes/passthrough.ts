// Duck-typed on purpose: this module imports no node classes and no editor.
import type { SocketDataType } from "../sockets";
import type { Shape } from "../frameShape";


export type CombineMode =
  | "single"
  | "agree"
  | "active";

export interface PassthroughSpec {
  output: string;
  inputs: string[];
  combine: CombineMode;
  activeIndex?: () => number;
  selected?: () => string | null;
  pure?: boolean;
  project?: (t: SocketDataType, ctx: ProjectContext) => SocketDataType;
}

export interface ProjectContext {
  shapeOf: (inputKey: string) => Shape | null;
  wired: (inputKey: string) => boolean;
}

export const BLIND_PROJECT_CONTEXT: ProjectContext = { shapeOf: () => null, wired: () => false };

interface HasPassthrough { passthrough(): PassthroughSpec[]; }

export function getPassthrough(n: unknown): PassthroughSpec[] {
  const f = (n as Partial<HasPassthrough> | null)?.passthrough;
  return typeof f === "function" ? f.call(n) : [];
}

export function isPassthroughNode(n: unknown): boolean {
  return getPassthrough(n).length > 0;
}

export function isPurePassthroughNode(n: unknown): boolean {
  return getPassthrough(n).some((s) => s.pure);
}

export function passthroughForOutput(n: unknown, outKey: string): PassthroughSpec | undefined {
  return getPassthrough(n).find((s) => s.output === outKey);
}

export function passInputKeys(n: unknown): string[] {
  return [...new Set(getPassthrough(n).flatMap((s) => s.inputs))];
}

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
  return undefined;
}

export function resolvePassthroughType(
  spec: PassthroughSpec,
  typeOf: (key: string) => SocketDataType | null,
  agree: (types: (SocketDataType | null)[]) => SocketDataType,
  ctx: ProjectContext = BLIND_PROJECT_CONTEXT,
): SocketDataType {
  const t = resolveForwardedType(spec, typeOf, agree);
  return spec.project ? spec.project(t, ctx) : t;
}

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
