// [[C25]] firstClassUnits
import { GraphNode } from "../graphModel";
import { cubeIn, dateIn, dateListIn, strIn, numIn, frameOut, numOut } from "./shared";
import { type FrameValue, type FrameCell } from "../frame";
import { type SolError } from "../errorValue";
import { nodeOnCore } from "../nodeOnCore";
import type { Shape } from "../frameShape";
import type { FrameHint } from "../frameHint";


const SUMMARY_COLS = ["BCWS", "BCWP", "ACWP", "SV", "CV", "SPI", "CPI", "EAC", "VAC", "TCPI"] as const;

export const EARNED_VALUE_DEFAULT_LITERALS: Readonly<Record<string, number>> = { weekend_code: 1 };

export class EarnedValueNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    schedule: "A scheduled project with a Cost column and Complete from 0 to 100. An Actual cost column is the real spend; without one it equals the earned value.",
    baseline: "The plan as it started: its Cost is the budget, its Start and Finish the planned pace. Rows match by task name. Unwired, the schedule is its own baseline.",
    status: "The day progress is measured on. Unwired, today.",
    holidays: "Dates to skip when measuring planned progress, alongside the weekend.",
    weekend_code: "Which days are the weekend. Excel: WORKDAY.INTL codes, 1 = Sat+Sun, 2 = Sun+Mon, 11 to 17 = a single day off.",
    cost: "The Cost column's name, when it isn't called Cost, Budget or BAC.",
    frame: "A row per task: BCWS, BCWP, ACWP, the SV and CV variances, the SPI and CPI indices, the EAC estimate at completion, then VAC and TCPI.",
    spi: "The project schedule performance index: earned over planned value.",
    cpi: "The project cost performance index: earned value over actual cost.",
    eac: "The estimate at completion: the budget over the cost performance index.",
  };

  label: string;
  // Keep the per-input unit strip off, or the Cost column's currency is gone before data() runs.
  unitAware = true;
  literals: Record<string, number> = { ...EARNED_VALUE_DEFAULT_LITERALS };
  stringLiterals: Record<string, string> = { cost: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedSpi: FrameCell | SolError | null = null;
  cachedCpi: FrameCell | SolError | null = null;
  cachedEac: FrameCell | SolError | null = null;
  width = 240; height = 240;

  static frameHints: Record<string, FrameHint> = {
    schedule: { columns: [
      { name: "Task", type: "string", cells: ["Design", "Build", "Test"] },
      { name: "Cost", type: "number", cells: [4000, 9000, 3000] },
      { name: "Complete", type: "number", cells: [100, 40, 0] },
    ] },
  };

  frameShape(outKey: string): Shape | null {
    if (outKey !== "frame") return null;
    return { columns: [{ name: "Task", type: "string" }, ...SUMMARY_COLS.map((n) => ({ name: n, type: "number" as const }))] };
  }

  constructor(init?: { label?: string }) {
    super("EarnedValue");
    this.label = init?.label ?? "Earned Value";
    this.addInput("schedule", cubeIn("Schedule"));
    this.addInput("baseline", cubeIn("Baseline"));
    this.addInput("status", dateIn("Status date"));
    this.addInput("holidays", dateListIn("Holidays"));
    this.addInput("weekend_code", numIn("Weekend"));
    this.addInput("cost", strIn("Cost column"));
    this.addOutput("frame", frameOut("Summary"));
    this.addOutput("spi", numOut("SPI"));
    this.addOutput("cpi", numOut("CPI"));
    this.addOutput("eac", numOut("EAC"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as {
      frame: FrameValue | SolError | null; spi: FrameCell | SolError | null; cpi: FrameCell | SolError | null; eac: FrameCell | SolError | null;
    };
  }
}
