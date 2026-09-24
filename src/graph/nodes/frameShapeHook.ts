// [[C8]] declareOnce.
import { parseListLiteral } from "../coerceInputs";
import type { Shape } from "../frameShape";

// Duck-typed on purpose: this module imports no node classes.

export interface FrameShapeContext {
  inputShape(inKey: string): Shape | null;
  wired(inKey: string): boolean;
}

interface HasFrameShape {
  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null;
}

export function frameShapeOf(n: unknown): HasFrameShape["frameShape"] | undefined {
  const f = (n as Partial<HasFrameShape> | null)?.frameShape;
  return typeof f === "function" ? f.bind(n) : undefined;
}

export function csvList(raw: string | undefined): string[] {
  return raw ? (parseListLiteral(raw, "strlist") as string[]) : [];
}
