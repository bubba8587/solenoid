// [[A1]] visualGraphCalculator: the Greedy Queue and Local Search cards (tree/specs/computation/frame-verbs.md § Greedy
// Queue, § Local Search).
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
  { value: "continue", label: "Carry on from the last item" },
  { value: "start", label: "Go back to Start each step" },
];

/** When the next item in order doesn't fit the budget: the group's step ends, or it tries the next in order. */
export type QueueFit = "stop" | "skip";
export const QUEUE_FIT_OPTIONS: { value: QueueFit; label: string }[] = [
  { value: "stop", label: "Stop at the first item that won't fit" },
  { value: "skip", label: "Skip items that won't fit" },
];

/** Who picks next: the groups in turn, one pick each a round; or the best group and item pair anywhere. */
export type QueueTurns = "rotate" | "best";
export const QUEUE_TURNS_OPTIONS: { value: QueueTurns; label: string }[] = [
  { value: "rotate", label: "Each group picks in turn" },
  { value: "best", label: "Best match goes first, any group" },
];

export class GreedyQueueNode extends GraphNode {
  static inputRoles = {
    perStep: setting(LEFT_OUT, "auto"),
    budget: setting(LEFT_OUT, "no limit"),
    steps: setting(LEFT_OUT, "until done"),
  };
  static socketDocs: Record<string, string> = {
    items: "The things to hand out, a row per item: jobs, stops, boxes. Formulas use its columns by name, and last_ plus a name for the item the group did just before.",
    start: "One row per group, such as a crew, a machine or a truck, with the group column to match. Formulas read its columns as group_ plus the name, such as group_Skill. A column with the same name as one of the items' is where the group starts, like a home address.",
    group: "The column saying which group each item belongs to. An item left blank can go to any group. Left empty, there is one group.",
    step: "The column saying when each item becomes available, such as a day number. Left empty, everything is available from the start.",
    perStep: "The most items a group takes each step. Left empty, one, or as many as fit the budget.",
    budget: "How much a group can use each step, such as 8 hours a day or 1,000 kg a truck. Each item's Cost counts against it. A step's first item always goes, even if it is over.",
    steps: "How many steps to run. Left empty, it keeps going until every item is taken.",
    order: "A formula that ranks the waiting items: the lowest number goes first. A list breaks ties: sort by the first value, then the next. Left empty, first come, first served.",
    cost: "A formula for what one item uses up: drive minutes, hours of work, kilograms. These add up to the total cost.",
    allowed: "A formula answering TRUE or FALSE: can this group take this item now? Use it for skills, opening hours or limits.",
    picks: "Every item taken, in the order taken, with the group that took it, the step, how long it waited and its cost.",
    left: "The items nobody took before the run ended.",
    total: "Every item's cost added up.",
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
    this.addInput("perStep", numIn("Picks per step"));
    this.addInput("budget", numIn("Budget per step"));
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

/** The columns the plan adds after the items' own, as the core names them (`nodes/improve.rs`). */
const PLAN_COLUMNS: { name: string; type: "number" | "logical" }[] = [
  { name: "Position", type: "number" }, { name: "Cost", type: "number" }, { name: "At", type: "number" },
  { name: "Penalty", type: "number" }, { name: "Allowed", type: "logical" },
];

/** Which moves a search makes: only reorder each group's own items, or also move items between groups. */
export type SearchReach = "across" | "within";
export const SEARCH_REACH_OPTIONS: { value: SearchReach; label: string }[] = [
  { value: "across", label: "Can move items between groups" },
  { value: "within", label: "Only reorder within each group" },
];

/** Whether a group's walk ends at its last item, or comes back to its Start row (a round trip). */
export type SearchEnds = "open" | "return";
export const SEARCH_ENDS_OPTIONS: { value: SearchEnds; label: string }[] = [
  { value: "open", label: "One way: ends at the last item" },
  { value: "return", label: "Round trip: back to Start" },
];

export class LocalSearchNode extends GraphNode {
  static inputRoles = {
    passes: setting(LEFT_OUT, "until nothing improves"),
  };
  static socketDocs: Record<string, string> = {
    items: "A plan to improve: a row per item, each group's items in the order they are done. Greedy Queue's picks work as they are. Formulas use its columns by name, and last_ plus a name for the item just before.",
    start: "One row per group, with the group column to match. Formulas read its columns as group_ plus the name. A column with the same name as one of the items' is where the group starts. A group listed here can take items even if it has none yet.",
    group: "The column saying which group each item belongs to. Left empty, there is one group and the search only reorders.",
    cost: "A formula for what one item adds, such as the drive from the stop before or a job's hours. It can read before, the group's cost so far, and position, the item's place in line.",
    penalty: "A formula for an extra charge on top of the cost, such as for finishing late. It can read at, the group's cost so far including this item.",
    allowed: "A formula answering TRUE or FALSE: can this item go here? A plan that breaks fewer of these always wins, then the one with the lower total.",
    passes: "How many times to go over every item looking for a better place. Left empty, until nothing improves.",
    plan: "The improved plan: each group's items in order, with the position, the cost, the running cost at, the penalty and whether it is allowed.",
    total: "Every cost and penalty added up. This is what the search makes smaller.",
    history: "One row per change made, starting from the plan as it came in: the kind of change and the total after it.",
  };
  static frameHints: Record<string, FrameHint> = {
    items: { columns: [
      { name: "Group", type: "string", cells: ["A", "A", "B"] },
      { name: "X", type: "number", cells: [3, 1, 2] },
    ] },
  };

  label: string;
  reach: SearchReach = "across";
  ends: SearchEnds = "open";
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { group: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedTotal: number | SolError | null = null;
  cachedHistory: FrameValue | SolError | null = null;
  width = 240; height = 280;

  constructor(init?: { label?: string; reach?: SearchReach; ends?: SearchEnds }) {
    super("LocalSearch");
    this.label = init?.label ?? "Local Search";
    if (init?.reach === "within") this.reach = "within";
    if (init?.ends === "return") this.ends = "return";
    this.addInput("items", frameIn("Plan"));
    this.addInput("cost", lambdaIn("Cost"));
    this.addInput("penalty", lambdaIn("Penalty"));
    this.addInput("group", strIn("Group column"));
    this.addInput("start", frameIn("Start"));
    this.addInput("allowed", lambdaIn("Allowed"));
    this.addInput("passes", numIn("Passes"));
    this.addOutput("plan", frameOut("Plan"));
    this.addOutput("total", numOut("Total"));
    this.addOutput("history", frameOut("Changes"));
  }

  /** The plan is the items with its numbers after them, replacing a column of the same name; the moves are fixed. */
  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    if (outKey === "history") {
      return { columns: [
        { name: "Change", type: "number" }, { name: "Kind", type: "string" }, { name: "Total", type: "number" }, { name: "Not Allowed", type: "number" },
      ] };
    }
    const input = ctx.inputShape("items");
    if (!input) return null;
    const taken = new Set(PLAN_COLUMNS.map((c) => c.name.toLowerCase()));
    return { ...input, columns: [...input.columns.filter((c) => !taken.has(c.name.trim().toLowerCase())), ...PLAN_COLUMNS] };
  }

  data(inputs: Record<string, unknown[] | undefined>): { plan: FrameValue | SolError | null; total: number | SolError | null; history: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { plan: FrameValue | SolError | null; total: number | SolError | null; history: FrameValue | SolError | null };
  }
}
