// [[C28]] literalsIffEditable
import { literalFieldOf, type LiteralFieldHost } from "../../src/graph/literalFields";

/** Sets a card's unwired values where its fields keep them (`literalFieldOf`): keyed text for a keyed slot, the number
 *  map for a number or logical one. Replaces both maps. */
export function keyIn(
  node: LiteralFieldHost & { literals?: Record<string, number>; stringLiterals?: Record<string, string> },
  values: Record<string, number>,
): void {
  node.literals = {};
  node.stringLiterals = {};
  for (const [k, v] of Object.entries(values)) {
    if (literalFieldOf(node, k) === "keyed") node.stringLiterals[k] = String(v);
    else node.literals[k] = v;
  }
}
