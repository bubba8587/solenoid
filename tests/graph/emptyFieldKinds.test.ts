// [[D96]] emptySlotShowsItsValue, [[inline-literal-maps#What an empty field is]]
import { it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { flattenLeaves } from "../../src/graph/catalogSearch";
import { literalFieldOf } from "../../src/graph/literalFields";
import { emptyFieldShown } from "../../src/graph/emptySlots";
import type { InputRole } from "../../src/graph/inputRoles";

// Their fields are a formula's variables, walked as a kind of nothing of their own.
const VARIABLES = new Set(["ExpressionNode", "LambdaNode", "ComputedColumnNode"]);

it("every card field declares what it is when empty: Fallback, Behavior, Example or Required", () => {
  const undeclared = new Set<string>();
  for (const { leaf } of flattenLeaves(buildCatalog(false)) as { leaf: { create?: () => unknown } }[]) {
    let node: { constructor: { name: string; inputRoles?: Record<string, InputRole> }; inputs: Record<string, unknown> };
    try { node = leaf.create?.() as typeof node; } catch { continue; }
    if (!node?.inputs) continue;
    const cls = node.constructor.name;
    if (VARIABLES.has(cls)) continue;
    for (const key of Object.keys(node.inputs)) {
      if (literalFieldOf(node as never, key) === "none") continue;
      if (!emptyFieldShown(cls, key, node.constructor.inputRoles?.[key])) undeclared.add(`${cls}.${key}`);
    }
  }
  expect([...undeclared].sort()).toEqual([]);
});
