// [[D96]] emptySlotShowsItsValue, [[inline-literal-maps#What an empty field is]]
// The worklist: every card field not yet declared Fallback, Behavior, Example or Required. It only shrinks: a new
// undeclared field fails, and so does a declared one still listed. `UPDATE_WORKLIST=1` rewrites the list after a
// batch of declarations.
import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { flattenLeaves } from "../../src/graph/catalogSearch";
import { literalFieldOf } from "../../src/graph/literalFields";
import { emptyFieldShown } from "../../src/graph/emptySlots";
import type { InputRole } from "../../src/graph/inputRoles";

const LIST = new URL("../fixtures/empty-field-worklist.json", import.meta.url);
// Their fields are a formula's variables, walked as a kind of nothing of their own.
const VARIABLES = new Set(["ExpressionNode", "LambdaNode", "ComputedColumnNode"]);

it("every card field declares what it is when empty, or is on the shrinking worklist", () => {
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
  const now = [...undeclared].sort();
  if (process.env.UPDATE_WORKLIST) writeFileSync(LIST, JSON.stringify(now, null, 1) + "\n");
  const listed: string[] = JSON.parse(readFileSync(LIST, "utf8"));
  const listedSet = new Set(listed);
  expect(now.filter((k) => !listedSet.has(k)), "undeclared and not on the worklist").toEqual([]);
  expect(listed.filter((k) => !undeclared.has(k)), "declared: drop from the worklist (UPDATE_WORKLIST=1)").toEqual([]);
});
