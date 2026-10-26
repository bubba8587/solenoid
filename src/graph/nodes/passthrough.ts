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
  /** What the output reads a forwarded table as (`settleFacts.ts` `ProjectFacts`). */
  project?: (ctx: ProjectContext) => { frame: SocketDataType; cube: SocketDataType; tables: "trueany" | "combo" };
}

export interface ProjectContext {
  shapeOf: (inputKey: string) => Shape | null;
  wired: (inputKey: string) => boolean;
}

interface HasPassthrough { passthrough(): PassthroughSpec[]; }

export function getPassthrough(n: unknown): PassthroughSpec[] {
  const f = (n as Partial<HasPassthrough> | null)?.passthrough;
  return typeof f === "function" ? f.call(n) : [];
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
