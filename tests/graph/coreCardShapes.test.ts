// [[D102]] graphOnCore, [[D99]] rustIsSpec
// A card's own static output shape, where no verb makes it (fixtures/core/card-shapes.json.gz): each card that names
// its output columns, in each of its modes, over a few input shapes, for every output.
import { describe, expect, it } from "vitest";
import { frozen } from "./coreFixtures";
import * as Nodes from "../../src/graph/nodeClasses";
import type { GraphNode } from "../../src/graph/graphModel";
import type { Shape } from "../../src/graph/frameShape";
import { frameShapeOf } from "../../src/graph/nodes/frameShapeHook";

const OPTIONS: Shape = { columns: [{ name: "Option", type: "string" }, { name: "Cost", type: "number" }, { name: "Fast", type: "logical" }, { name: "Due", type: "date" }] };
const NAMED: Shape = { columns: [{ name: "Who", type: "string" }, { name: "Paid", type: "number" }, { name: "share", type: "number" }] };
const NUMS: Shape = { columns: [{ name: "a", type: "number" }, { name: "b", type: "number" }] };
const DEBTS: Shape = { columns: [{ name: "Card", type: "string" }, { name: "Balance", type: "number" }, { name: "APR", type: "number" }, { name: "Min", type: "number" }] };

const CARDS: [string, Record<string, unknown>[]][] = [
  ["DecisionSensitivityNode", [{ mode: "flips" }, { mode: "scenarios" }]],
  ["ChoiceLadderNode", [{}]],
  ["PayoffPlannerNode", [{ mode: "summary" }, { mode: "schedule" }]],
  ["SettleNode", [{ mode: "totals" }, { mode: "ledger" }]],
  ["DecisionMatrixNode", [{ detail: "breakdown" }, { detail: "score" }]],
  ["AmortizationNode", [{}]],
  ["WorldClockNode", [{}]],
  ["EarnedValueNode", [{}]],
  ["WeatherNode", [{}]],
  ["HolidaysNode", [{}]],
  ["FxNode", [{ mode: "spot" }, { mode: "history" }]],
  ["SlicerNode", [{}]],
  ["DropBlankRowsNode", [{}]],
  ["FindPeaksNode", [{}]],
  ["EtsForecastNode", [{}]],
  ["FitDistributionNode", [{}]],
  ["DecomposeNode", [{}]],
  ["OdeIntegrateNode", [{}]],
  ["ScheduleNode", [{}]],
];

type Case = { card: string; init: Record<string, unknown>; input: string; wired: string[]; want?: Record<string, Shape | null> };

const INPUTS: Record<string, Shape | null> = { none: null, OPTIONS, NAMED, NUMS, DEBTS };

function answer(c: Case): Record<string, Shape | null> {
  const Ctor = (Nodes as unknown as Record<string, new (init?: Record<string, unknown>) => GraphNode>)[c.card];
  const node = new Ctor({ ...c.init });
  const hook = frameShapeOf(node)!;
  const shape = INPUTS[c.input];
  const ctx = { inputShape: () => shape, wired: (k: string) => c.wired.includes(k) || (shape !== null && Object.keys(node.inputs).includes(k)) };
  const out: Record<string, Shape | null> = {};
  for (const k of Object.keys(node.outputs)) {
    try { out[k] = hook(k, ctx); } catch { out[k] = null; }
  }
  return out;
}

describe("a card's own static shape holds to its frozen answers", () => {
  it("every card that names its columns, in each mode, over each input shape", () => {
    const fresh: Case[] = [];
    for (const [card, inits] of CARDS) {
      for (const init of inits) {
        for (const input of Object.keys(INPUTS)) {
          const c: Case = { card, init, input, wired: [] };
          fresh.push({ ...c, want: answer(c) });
        }
      }
    }
    const cases = frozen<Case>("card-shapes", () => fresh);
    expect(cases.length).toBe(fresh.length);
    const bad = cases.filter((c, i) => JSON.stringify(c.want) !== JSON.stringify(fresh[i].want)).map((c) => `${c.card} ${JSON.stringify(c.init)} ${c.input}`);
    expect(bad).toEqual([]);
  });
});
