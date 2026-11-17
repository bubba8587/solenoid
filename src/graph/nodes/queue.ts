// [[A1]] visualGraphCalculator: the Greedy Queue card (tree/specs/computation/frame-verbs.md § Greedy Queue).
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { setting, LEFT_OUT } from "../inputRoles";
import { frameIn, frameOut, strIn, numIn, numOut, lambdaIn } from "./shared";
import type { FrameValue } from "../frame";
import type { SolError } from "../errorValue";
import type { FrameHint } from "../frameHint";
import type { Shape } from "../frameShape";
import type { FrameShapeContext } from "./frameShapeHook";

/** The columns the picks add after the items' own, as the core names them (`nodes/queue.rs`). */
const PICK_COLUMNS = ["Picked", "Wait", "Cost", "Used Before"];

/** Where a group's state starts each step: its last pick, or its Start row again. */
export type QueueStepStart = "continue" | "start";
export const QUEUE_STEP_START_OPTIONS: { value: QueueStepStart; label: string }[] = [
  { value: "continue", label: "Each step from the last pick" },
  { value: "start", label: "Each step from the Start row" },
];

/** When the next item in order doesn't fit the budget: the group's step ends, or it tries the next in order. */
export type QueueFit = "stop" | "skip";
export const QUEUE_FIT_OPTIONS: { value: QueueFit; label: string }[] = [
  { value: "stop", label: "Next doesn't fit: end the step" },
  { value: "skip", label: "Next doesn't fit: try the one after" },
];

/** Who picks next: the groups in turn, one pick each a round; or the best group and item pair anywhere. */
export type QueueTurns = "rotate" | "best";
export const QUEUE_TURNS_OPTIONS: { value: QueueTurns; label: string }[] = [
  { value: "rotate", label: "Groups take turns" },
  { value: "best", label: "Best pair first" },
];

export class GreedyQueueNode extends GraphNode {
  static inputRoles = {
    perStep: setting(LEFT_OUT, "auto"),
    budget: setting(LEFT_OUT, "no limit"),
    steps: setting(LEFT_OUT, "until done"),
  };
  static socketDocs: Record<string, string> = {
    items: "A row per item to pick. Every column is a name the formulas can read, and the same name with last_ in front reads the group's last pick.",
    start: "A row per group, matched by the group column. Its columns read as group_ names in the formulas (a skill, its hours), and as last_ names before the group's first pick where they match the items'. A group named here exists even with no item of its own.",
    group: "An item with a group is that group's alone; one with a blank group is anyone's, and the groups take turns picking. Items without the column are all anyone's, the groups named by Start. Blank: one group takes everything.",
    step: "The step an item opens on. Blank: every item is open from step 1.",
    perStep: "The most picks a group makes a step. Blank: one, or with a Budget, as many as fit.",
    budget: "What a group can spend a step: it keeps picking while each pick's Cost still fits. A step's first pick always goes.",
    steps: "How many steps run from the first item's step; items still waiting then are left. Blank: until every item is picked.",
    order: "A LAMBDA over the item's columns, last_ columns, wait, step and used: the waiting item it puts first, smallest first, is picked. A list sorts by its first value, then its second. Unwired, the first in line.",
    cost: "A LAMBDA over the same names: what a pick spends from the Budget. Unwired, 0.",
    allowed: "A LAMBDA over the same names answering TRUE or FALSE: whether this group may take this item now. A group passes over an item it may not take. Unwired, every item.",
    picks: "The items picked, in the order they were picked, with the group that took each, the step, the steps waited, the cost and the budget used before it.",
    left: "The items never picked in the steps run.",
    total: "Every pick's Cost added up: the run's total drive, hours or weight.",
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
  mode: QueueFit = "stop";
  turns: QueueTurns = "rotate";
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { group: "", step: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedLeft: FrameValue | SolError | null = null;
  cachedTotal: number | SolError | null = null;
  width = 240; height = 300;

  constructor(init?: { label?: string; stepStart?: QueueStepStart; mode?: QueueFit; turns?: QueueTurns }) {
    super("GreedyQueue");
    this.label = init?.label ?? "Greedy Queue";
    if (init?.stepStart === "start") this.stepStart = "start";
    if (init?.mode === "skip") this.mode = "skip";
    if (init?.turns === "best") this.turns = "best";
    // In the card's order: what and which first, then the Groups, Steps and Budget sections.
    this.addInput("items", frameIn("Items"));
    this.addInput("order", lambdaIn("Order by"));
    this.addInput("cost", lambdaIn("Cost"));
    this.addInput("group", strIn("Group column"));
    this.addInput("start", frameIn("Start"));
    this.addInput("allowed", lambdaIn("Allowed"));
    this.addInput("step", strIn("Step column"));
    this.addInput("steps", numIn("Steps"));
    this.addInput("perStep", numIn("Picks a step"));
    this.addInput("budget", numIn("Budget a step"));
    this.addOutput("picks", frameOut("Picks"));
    this.addOutput("left", frameOut("Left"));
    this.addOutput("total", numOut("Total cost"));
  }

  /** Left is the items as they came; Picks adds its numbers after them, replacing a column of the same name. */
  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("items");
    if (!input) return null;
    if (outKey === "left") return input;
    const taken = new Set(PICK_COLUMNS.map((n) => n.toLowerCase()));
    // Items without the group column Start names are anyone's, and Picks gains it: the group that took each.
    const group = (this.stringLiterals.group ?? "").trim();
    const has = (shape: Shape | null, name: string) => !!shape?.columns.some((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    const gains = !ctx.wired("group") && group !== "" && !has(input, group) && has(ctx.inputShape("start"), group);
    return {
      ...input,
      columns: [
        ...(gains ? [{ name: group, type: "string" as const }] : []),
        ...input.columns.filter((c) => !taken.has(c.name.trim().toLowerCase())),
        ...PICK_COLUMNS.map((name) => ({ name, type: "number" as const })),
      ],
    };
  }

  data(inputs: Record<string, unknown[] | undefined>): { picks: FrameValue | SolError | null; left: FrameValue | SolError | null; total: number | SolError | null } {
    return nodeOnCore(this, inputs) as { picks: FrameValue | SolError | null; left: FrameValue | SolError | null; total: number | SolError | null };
  }
}
