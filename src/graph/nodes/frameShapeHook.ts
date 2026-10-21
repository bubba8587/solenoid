import { parseListLiteral } from "../coerceInputs";
import { csvField } from "../csvSafety";
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

/** The literal `csvList` reads back as `names`: a name holding a comma or quote is quoted, and fields join on a bare comma, since a quote after a space doesn't open a quoted field. */
export function listLiteralText(names: readonly string[]): string {
  return names.map((n) => csvField(n, false)).join(",");
}
