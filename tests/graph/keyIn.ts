import { isKeyedWildcard } from "../../src/graph/keyedLiterals";
import { declaredTypeOf } from "../../src/graph/sockets";

/** Sets a card's unwired values where its fields keep them: keyed text for a wildcard slot, the number field for any
 *  other. Replaces both maps. */
export function keyIn(
  node: { inputs: Record<string, { socket?: unknown } | undefined>; literals?: Record<string, number>; stringLiterals?: Record<string, string> },
  values: Record<string, number>,
): void {
  node.literals = {};
  node.stringLiterals = {};
  for (const [k, v] of Object.entries(values)) {
    if (isKeyedWildcard(declaredTypeOf(node.inputs[k]?.socket))) node.stringLiterals[k] = String(v);
    else node.literals[k] = v;
  }
}
