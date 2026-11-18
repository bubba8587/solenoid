// [[A1]] visualGraphCalculator: the optimization cards beside Greedy Queue and Local Search
// (tree/specs/computation/frame-verbs.md § Solver).
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { frameIn, frameOut, strIn, strListIn, numIn, numOut } from "./shared";
import type { FrameValue } from "../frame";
import type { SolError } from "../errorValue";
import type { FrameHint } from "../frameHint";
import type { Shape } from "../frameShape";
import type { FrameShapeContext } from "./frameShapeHook";
import type { ColumnPickerSpec } from "./columnPickerHook";

/** Whether the Solver makes the goal column's total as large or as small as the limits allow. */
export type SolverGoal = "max" | "min";
export const SOLVER_GOAL_OPTIONS: { value: SolverGoal; label: string }[] = [
  { value: "max", label: "Maximize" },
  { value: "min", label: "Minimize" },
];

const added = (shape: Shape, cols: { name: string; type: "number" | "logical" }[]): Shape => {
  const taken = new Set(cols.map((c) => c.name.toLowerCase()));
  return { ...shape, columns: [...shape.columns.filter((c) => !taken.has(c.name.trim().toLowerCase())), ...cols] };
};

export class SolverNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    options: "One row per decision. Optional Min, Max and Whole columns bound each amount.",
    limits: "One row per limit: Sum of a column, Where a column Is a value, then Sign and Limit.",
  };
  static frameHints: Record<string, FrameHint> = {
    options: { columns: [
      { name: "Product", type: "string", cells: ["Chair", "Table", "Desk"] },
      { name: "Profit", type: "number", cells: [45, 80, 110] },
      { name: "Wood", type: "number", cells: [2, 5, 6] },
    ] },
    limits: { columns: [
      { name: "Sum of", type: "string", cells: ["Wood", "Labor", ""] },
      { name: "Sign", type: "string", cells: ["<=", "<=", ">="] },
      { name: "Limit", type: "number", cells: [300, 330, 10] },
    ] },
  };

  label: string;
  goal: SolverGoal = "max";
  stringLiterals: Record<string, string> = { objective: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedBest: number | SolError | null = null;
  cachedLimits: FrameValue | SolError | null = null;
  cachedStatus: string | null = null;
  width = 260; height = 260;

  constructor(init?: { label?: string; goal?: SolverGoal }) {
    super("Solver");
    this.label = init?.label ?? "Solver";
    if (init?.goal === "min") this.goal = "min";
    this.addInput("options", frameIn("Options"));
    this.addInput("objective", strIn("Goal"));
    this.addInput("limits", frameIn("Limits"));
    this.addOutput("plan", frameOut("Plan"));
    this.addOutput("best", numOut("Best"));
    this.addOutput("limits", frameOut("Limits"));
  }

  columnPickers(): ColumnPickerSpec[] { return [{ key: "objective", frameInput: "options" }]; }

  /** The plan is Options with Amount after; the limits gain Used, Slack and Shadow Price. */
  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    if (outKey === "plan") {
      const s = ctx.inputShape("options");
      return s && added(s, [{ name: "Amount", type: "number" }]);
    }
    const s = ctx.inputShape("limits");
    return s && added(s, [{ name: "Used", type: "number" }, { name: "Slack", type: "number" }, { name: "Shadow Price", type: "number" }]);
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { plan: FrameValue | SolError | null; best: number | SolError | null; limits: FrameValue | SolError | null };
  }
}

/** Whether Assignment makes the total of the chosen cells least (costs, distances) or greatest (scores, profit). */
export type AssignGoal = "min" | "max";
export const ASSIGN_GOAL_OPTIONS: { value: AssignGoal; label: string }[] = [
  { value: "min", label: "Least total" },
  { value: "max", label: "Greatest total" },
];

export class AssignmentNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    costs: "A row per person, a column per job. A blank cell: that pair can't be made.",
  };
  static frameHints: Record<string, FrameHint> = {
    costs: { columns: [
      { name: "Crew", type: "string", cells: ["Ana", "Bo", "Cy"] },
      { name: "Job 1", type: "number", cells: [4, 2, 3] },
      { name: "Job 2", type: "number", cells: [1, 0, 2] },
    ] },
  };

  label: string;
  goal: AssignGoal = "min";
  cachedResult: FrameValue | SolError | null = null;
  cachedTotal: number | SolError | null = null;
  width = 230; height = 220;

  constructor(init?: { label?: string; goal?: AssignGoal }) {
    super("Assignment");
    this.label = init?.label ?? "Assignment";
    if (init?.goal === "max") this.goal = "max";
    this.addInput("costs", frameIn("Costs"));
    this.addOutput("pairs", frameOut("Pairs"));
    this.addOutput("total", numOut("Total"));
  }

  /** The row names (the first column, when it holds text), then Assigned and Cost. */
  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const s = ctx.inputShape("costs");
    if (!s) return null;
    const first = s.columns[0]?.type === "string" ? [s.columns[0]] : [];
    return { ...s, columns: [...first, { name: "Assigned", type: "string" }, { name: "Cost", type: "number" }] };
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { pairs: FrameValue | SolError | null; total: number | SolError | null };
  }
}

/** Whether each link can be taken both ways (roads) or only From to To (one-way streets, task order). */
export type PathDirection = "both" | "one";
export const PATH_DIRECTION_OPTIONS: { value: PathDirection; label: string }[] = [
  { value: "both", label: "Both ways" },
  { value: "one", label: "From → To only" },
];

export class ShortestPathNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    links: "A row per link, with From and To columns.",
    to: "Empty: the distance to every place.",
  };
  static frameHints: Record<string, FrameHint> = {
    links: { columns: [
      { name: "From", type: "string", cells: ["Depot", "Depot", "A"] },
      { name: "To", type: "string", cells: ["A", "B", "B"] },
      { name: "Km", type: "number", cells: [4, 9, 3] },
    ] },
  };

  label: string;
  direction: PathDirection = "both";
  stringLiterals: Record<string, string> = { cost: "", from: "", to: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedTotal: number | SolError | null = null;
  width = 230; height = 240;

  constructor(init?: { label?: string; direction?: PathDirection }) {
    super("ShortestPath");
    this.label = init?.label ?? "Shortest Path";
    if (init?.direction === "one") this.direction = "one";
    this.addInput("links", frameIn("Links"));
    this.addInput("cost", strIn("Cost"));
    this.addInput("from", strIn("From"));
    this.addInput("to", strIn("To"));
    this.addOutput("path", frameOut("Path"));
    this.addOutput("total", numOut("Total"));
  }

  columnPickers(): ColumnPickerSpec[] { return [{ key: "cost", frameInput: "links" }]; }

  /** A path step by step; with no To, every place reached. */
  frameShape(): Shape | null {
    return (this.stringLiterals.to ?? "").trim()
      ? { columns: [{ name: "Step", type: "number" }, { name: "Place", type: "string" }, { name: "Leg", type: "number" }, { name: "So Far", type: "number" }] }
      : { columns: [{ name: "Place", type: "string" }, { name: "Distance", type: "number" }, { name: "Via", type: "string" }] };
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { path: FrameValue | SolError | null; total: number | SolError | null };
  }
}

export class ParetoNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    front: "The options no other option beats on every measure.",
    all: "Every option, with On Front and how many options beat it.",
  };
  static frameHints: Record<string, FrameHint> = {
    options: { columns: [
      { name: "Plan", type: "string", cells: ["A", "B", "C"] },
      { name: "Cost", type: "number", cells: [100, 120, 130] },
      { name: "Hours", type: "number", cells: [50, 40, 45] },
    ] },
  };

  label: string;
  stringLiterals: Record<string, string> = { lower: "", higher: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedAll: FrameValue | SolError | null = null;
  width = 230; height = 230;

  constructor(init?: { label?: string }) {
    super("Pareto");
    this.label = init?.label ?? "Pareto Front";
    this.addInput("options", frameIn("Options"));
    this.addInput("lower", strListIn("Lower is better"));
    this.addInput("higher", strListIn("Higher is better"));
    this.addOutput("front", frameOut("Front"));
    this.addOutput("all", frameOut("All"));
  }

  columnPickers(): ColumnPickerSpec[] { return [{ key: "lower", frameInput: "options" }, { key: "higher", frameInput: "options" }]; }

  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    const s = ctx.inputShape("options");
    if (!s || outKey === "front") return s;
    return added(s, [{ name: "On Front", type: "logical" }, { name: "Beaten By", type: "number" }]);
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { front: FrameValue | SolError | null; all: FrameValue | SolError | null };
  }
}

export class StaffingNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    target: "The wait a job should start within, in minutes. Empty: at once.",
    share: "The share of jobs to start within the target, such as 0.8.",
    options: "A row per server count, from the fewest that keep up.",
  };

  label: string;
  literals: Record<string, number> = {};
  cachedResult: FrameValue | SolError | null = null;
  cachedNeeded: number | SolError | null = null;
  width = 240; height = 260;

  constructor(init?: { label?: string }) {
    super("Staffing");
    this.label = init?.label ?? "Staffing (Erlang C)";
    this.addInput("arrivals", numIn("Arrivals an hour"));
    this.addInput("minutes", numIn("Minutes a job"));
    this.addInput("target", numIn("Target wait (min)"));
    this.addInput("share", numIn("Share within target"));
    this.addOutput("options", frameOut("Options"));
    this.addOutput("needed", numOut("Servers needed"));
  }

  frameShape(): Shape | null {
    return { columns: ["Servers", "Busy", "Chance of Waiting", "Mean Wait (min)", "Within Target"].map((name) => ({ name, type: "number" as const })) };
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { options: FrameValue | SolError | null; needed: number | SolError | null };
  }
}
