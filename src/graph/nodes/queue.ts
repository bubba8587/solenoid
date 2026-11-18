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
import type { ColumnPickerSpec } from "./columnPickerHook";

/** The columns the picks add after the items' own, as the core names them (`nodes/queue.rs`). */
const PICK_COLUMNS = ["Picked", "Wait", "Cost", "Used Before"];

/** Where a group's state starts each step: its last pick, or its Start row again. */
export type QueueStepStart = "continue" | "start";
export const QUEUE_STEP_START_OPTIONS: { value: QueueStepStart; label: string }[] = [
  { value: "continue", label: "Where it left off" },
  { value: "start", label: "Back at its start" },
];
/** The question the step-start pick answers, shown before it. */
export const QUEUE_STEP_START_ASK = "Each step starts";

/** When the next item in order doesn't fit the budget: the group's step ends, or it tries the next in order. */
export type QueueFit = "stop" | "skip";
export const QUEUE_FIT_OPTIONS: { value: QueueFit; label: string }[] = [
  { value: "stop", label: "Stop" },
  { value: "skip", label: "Skip it" },
];
export const QUEUE_FIT_ASK = "If an item won't fit";

/** Which way the Order by column runs: its smallest value first, or its largest. */
export type QueueOrderDir = "asc" | "desc";

/** What decides the next item: a column (with an Order formula after it), or the item's own cost, cheapest first. */
export type QueueOrderBy = "column" | "cost";
/** The card's one order toggle: the Order by column either way, or the item's own cost. */
export const QUEUE_ORDER_OPTIONS: { value: QueueOrderDir | "cost"; label: string }[] = [
  { value: "asc", label: "Smallest first" },
  { value: "desc", label: "Largest first" },
  { value: "cost", label: "Cheapest first" },
];

/** Who picks next: the groups in turn, one pick each a round; or the best group and item pair anywhere. */
export type QueueTurns = "rotate" | "best";
export const QUEUE_TURNS_OPTIONS: { value: QueueTurns; label: string }[] = [
  { value: "rotate", label: "Each group in turn" },
  { value: "best", label: "Best match, any group" },
];
export const QUEUE_TURNS_ASK = "Who picks next";

export class GreedyQueueNode extends GraphNode {
  /** A Budget arrives with its unit, which the costs must share ([[C25]] firstClassUnits). */
  unitAware = true;
  static inputRoles = {
    perStep: setting(LEFT_OUT, "auto"),
    budget: setting(LEFT_OUT, "no limit"),
    steps: setting(LEFT_OUT, "until done"),
  };
  static socketDocs: Record<string, string> = {
    items: "One row per item. Formulas read its columns by name, and last_ columns for the group's previous item.",
    start: "One row per group. Formulas read its columns as group_ columns.",
    group: "A blank cell lets any group take the item.",
    step: "When each item becomes available. Empty: all at once.",
    budget: "Each item's cost counts against it. A step's first item always goes.",
    orderColumn: "Neither this nor an Order formula: first in line.",
    order: "A LAMBDA, lowest first: the order where no Order by column is set, otherwise a tie-break.",
    cost: "A LAMBDA added to the Cost column, such as the drive from the last item.",
    allowed: "A LAMBDA: TRUE if this group may take this item now.",
    picks: "In pick order, with the step, wait and cost.",
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
  orderDir: QueueOrderDir = "asc";
  orderBy: QueueOrderBy = "column";
  stringLiterals: Record<string, string> = { group: "", step: "", orderColumn: "", costColumn: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedLeft: FrameValue | SolError | null = null;
  cachedTotal: number | SolError | null = null;
  /** How many picks were over the budget on their own (a step's first pick always goes), shown when any were. */
  cachedOver: number | null = null;
  width = 280; height = 300;

  constructor(init?: { label?: string; stepStart?: QueueStepStart; mode?: QueueFit; turns?: QueueTurns; orderDir?: QueueOrderDir; orderBy?: QueueOrderBy }) {
    super("GreedyQueue");
    this.label = init?.label ?? "Greedy Queue";
    if (init?.orderDir === "desc") this.orderDir = "desc";
    if (init?.orderBy === "cost") this.orderBy = "cost";
    if (init?.stepStart === "start") this.stepStart = "start";
    if (init?.mode === "skip") this.mode = "skip";
    if (init?.turns === "best") this.turns = "best";
    // In the card's order: what and which first, then the Groups, Steps and Budget sections.
    this.addInput("items", frameIn("Items"));
    this.addInput("orderColumn", strIn("Order by"));
    this.addInput("order", lambdaIn("Order formula"));
    this.addInput("costColumn", strIn("Cost"));
    this.addInput("cost", lambdaIn("Cost formula"));
    this.addInput("group", strIn("Group column"));
    this.addInput("start", frameIn("Groups"));
    this.addInput("allowed", lambdaIn("Allowed if"));
    this.addInput("step", strIn("Opens at"));
    this.addInput("steps", numIn("Steps to run"));
    this.addInput("perStep", numIn("Picks per step"));
    this.addInput("budget", numIn("Budget per step"));
    this.addOutput("picks", frameOut("Picks"));
    this.addOutput("left", frameOut("Left"));
    this.addOutput("total", numOut("Total"));
  }

  columnPickers(): ColumnPickerSpec[] {
    return ["orderColumn", "costColumn", "group", "step"].map((key) => ({ key, frameInput: "items" }));
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
  { name: "Position", type: "number" }, { name: "Cost", type: "number" }, { name: "So Far", type: "number" },
  { name: "Penalty", type: "number" }, { name: "Allowed", type: "logical" },
];

/** Which moves a search makes: only reorder each group's own items, or also move items between groups. */
export type SearchReach = "across" | "within";
export const SEARCH_REACH_OPTIONS: { value: SearchReach; label: string }[] = [
  { value: "across", label: "Move between groups" },
  { value: "within", label: "Stay in their group" },
];
export const SEARCH_REACH_ASK = "Items may";

/** Whether a group's walk ends at its last item, or comes back to its Start row (a round trip). */
export type SearchEnds = "open" | "return";
export const SEARCH_ENDS_OPTIONS: { value: SearchEnds; label: string }[] = [
  { value: "open", label: "At its last item" },
  { value: "return", label: "Back at its start" },
];
export const SEARCH_ENDS_ASK = "Each group ends";

/** How hard the search looks: stop at the first plan no single change improves, or look past it (guided local search),
 *  for up to ten times as long, keeping the best plan found. Thorough is never worse, only slower. */
export type SearchStuck = "stop" | "look";
export const SEARCH_STUCK_OPTIONS: { value: SearchStuck; label: string; title?: string }[] = [
  { value: "stop", label: "Quick" },
  { value: "look", label: "Thorough", title: "Searches past dead ends, up to 10× longer. Never worse." },
];

export class LocalSearchNode extends GraphNode {
  static inputRoles = {
    passes: setting(LEFT_OUT, "until done"),
  };
  static socketDocs: Record<string, string> = {
    items: "Each group's items in order, such as Greedy Queue's picks.",
    start: "One row per group, read as group_ columns. A group listed here can take items.",
    group: "Empty: one group, reordered only.",
    cost: "A LAMBDA added to the Cost column. It can read before, the cost so far, and position.",
    penalty: "A LAMBDA added to the total, such as lateness. It can read at, the cost through this item.",
    allowed: "A LAMBDA: TRUE if this item may go here. Fewer refusals always win.",
    history: "One row per change made.",
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
  stuck: SearchStuck = "stop";
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { group: "", costColumn: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedTotal: number | SolError | null = null;
  cachedHistory: FrameValue | SolError | null = null;
  width = 280; height = 280;

  constructor(init?: { label?: string; reach?: SearchReach; ends?: SearchEnds; stuck?: SearchStuck }) {
    super("LocalSearch");
    this.label = init?.label ?? "Local Search";
    if (init?.reach === "within") this.reach = "within";
    if (init?.ends === "return") this.ends = "return";
    if (init?.stuck === "look") this.stuck = "look";
    this.addInput("items", frameIn("Plan"));
    this.addInput("costColumn", strIn("Cost"));
    this.addInput("cost", lambdaIn("Cost formula"));
    this.addInput("penalty", lambdaIn("Penalty"));
    this.addInput("group", strIn("Group column"));
    this.addInput("start", frameIn("Groups"));
    this.addInput("allowed", lambdaIn("Allowed if"));
    this.addInput("passes", numIn("Rounds"));
    this.addOutput("plan", frameOut("Plan"));
    this.addOutput("total", numOut("Total"));
    this.addOutput("history", frameOut("Changes"));
  }

  columnPickers(): ColumnPickerSpec[] {
    return ["costColumn", "group"].map((key) => ({ key, frameInput: "items" }));
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
