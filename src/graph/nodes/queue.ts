// [[A1]] visualGraphCalculator: the Greedy Queue card (tree/specs/computation/frame-verbs.md § Greedy Queue).
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { setting, LEFT_OUT } from "../inputRoles";
import { frameIn, frameOut, strIn, numIn, lambdaIn } from "./shared";
import type { FrameValue } from "../frame";
import type { SolError } from "../errorValue";
import type { FrameHint } from "../frameHint";
import type { Shape } from "../frameShape";
import type { FrameShapeContext } from "./frameShapeHook";

/** The columns the picks add after the items' own, as the core names them (`nodes/queue.rs`). */
const PICK_COLUMNS = ["Picked", "Wait", "Score", "Cost", "Used Before"];

/** Where a group's state starts each step: its last pick, or its Start row again. */
export type QueueStepStart = "continue" | "start";
export const QUEUE_STEP_START_OPTIONS: { value: QueueStepStart; label: string }[] = [
  { value: "continue", label: "Each step from the last pick" },
  { value: "start", label: "Each step from the Start row" },
];

export class GreedyQueueNode extends GraphNode {
  static inputRoles = {
    perStep: setting(LEFT_OUT, "1, or as the budget allows"),
    budget: setting(LEFT_OUT, "no limit"),
    steps: setting(LEFT_OUT, "last item's step"),
  };
  static socketDocs: Record<string, string> = {
    items: "A row per item to pick. Every column is a name the Score and Cost formulas can read, and the same name with last_ in front reads the group's last pick.",
    start: "A row per group, matched by the group column: what last_ reads before a group's first pick. Its columns match the items' by name.",
    group: "Items of each group run on their own queue. Blank: one queue for every item.",
    step: "The step an item opens on. Blank: every item is open from step 1.",
    perStep: "The most picks a group makes a step. Blank: one, or with a Budget, as many as fit.",
    budget: "What a group can spend a step: it keeps picking while each pick's Cost still fits. A step's first pick always goes.",
    steps: "How many steps run from the first item's step. Items opening later are left.",
    score: "A LAMBDA over the item's columns, last_ columns, wait, step and used: the waiting item scoring lowest is picked. Unwired, the first in line.",
    cost: "A LAMBDA over the same names: what a pick spends from the Budget. Unwired, 0.",
    picks: "The items picked, in order, with the step picked, the steps waited, the score, the cost and the budget used before it.",
    left: "The items never picked in the steps run.",
  };
  static frameHints: Record<string, FrameHint> = {
    items: { columns: [
      { name: "Group", type: "string", cells: ["A", "A", "B"] },
      { name: "Step", type: "number", cells: [1, 1, 2] },
      { name: "Priority", type: "number", cells: [3, 5, 2] },
    ] },
  };

  label: string;
  stepStart: QueueStepStart = "continue";
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { group: "", step: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedLeft: FrameValue | SolError | null = null;
  width = 240; height = 300;

  constructor(init?: { label?: string; stepStart?: QueueStepStart }) {
    super("GreedyQueue");
    this.label = init?.label ?? "Greedy Queue";
    if (init?.stepStart === "start") this.stepStart = "start";
    this.addInput("items", frameIn("Items"));
    this.addInput("start", frameIn("Start"));
    this.addInput("group", strIn("Group column"));
    this.addInput("step", strIn("Step column"));
    this.addInput("score", lambdaIn("Score"));
    this.addInput("cost", lambdaIn("Cost"));
    this.addInput("perStep", numIn("Picks a step"));
    this.addInput("budget", numIn("Budget a step"));
    this.addInput("steps", numIn("Steps"));
    this.addOutput("picks", frameOut("Picks"));
    this.addOutput("left", frameOut("Left"));
  }

  /** Left is the items as they came; Picks adds its numbers after them, replacing a column of the same name. */
  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("items");
    if (!input) return null;
    if (outKey === "left") return input;
    const taken = new Set(PICK_COLUMNS.map((n) => n.toLowerCase()));
    return {
      ...input,
      columns: [
        ...input.columns.filter((c) => !taken.has(c.name.trim().toLowerCase())),
        ...PICK_COLUMNS.map((name) => ({ name, type: "number" as const })),
      ],
    };
  }

  data(inputs: Record<string, unknown[] | undefined>): { picks: FrameValue | SolError | null; left: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { picks: FrameValue | SolError | null; left: FrameValue | SolError | null };
  }
}
