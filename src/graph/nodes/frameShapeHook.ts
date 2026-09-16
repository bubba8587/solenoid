import { parseListLiteral } from "../coerceInputs";
import type { Shape } from "../frameShape";

// The ONE declaration every frame PRODUCER makes about its output columns — the producer
// sibling of `passthrough()`. Duck-typed: this module imports no node classes.
//
// The contract of `frameShape(outKey, ctx)`: return the static Shape of `outKey`, derived
// from the wired input shapes and the node's OWN literals (an UNWIRED socket's literal
// only — a cable's runtime value isn't knowable here), or `null` when unknown. A
// misconfigured verb may throw the same #REF!/#VALUE! its run would; the resolver swallows
// it to `null`. A node declaring neither this nor `passthrough()` is an unknown producer.

export interface FrameShapeContext {
  /** The static shape arriving on an INPUT socket; null when unwired or unknown. */
  inputShape(inKey: string): Shape | null;
  /** Whether a cable feeds that input — a literal speaks only for an UNWIRED socket. */
  wired(inKey: string): boolean;
}

interface HasFrameShape {
  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null;
}

/** A node's shape declaration, bound to it; undefined when it declares none. */
export function frameShapeOf(n: unknown): HasFrameShape["frameShape"] | undefined {
  const f = (n as Partial<HasFrameShape> | null)?.frameShape;
  return typeof f === "function" ? f.bind(n) : undefined;
}

/** A typed-in column-list literal, parsed exactly as its socket's coercion parses it. */
export function csvList(raw: string | undefined): string[] {
  return raw ? (parseListLiteral(raw, "strlist") as string[]) : [];
}
