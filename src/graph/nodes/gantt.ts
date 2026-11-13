// [[C69]], [[C70]], [[C71]]
import { GraphNode } from "../graphModel";
import { cubeIn, strIn, dateIn, dateListIn, chartOut } from "./shared";
import { type ChartOptions } from "./chartOptions";
import { type SolError } from "../errorValue";
import type { ChartValue } from "../chartValue";
import { nodeOnCore } from "../nodeOnCore";


export const GANTT_DEFAULT_LITERALS: Readonly<Record<string, number>> = { weekend_code: 1 };

export class GanttNode extends GraphNode {
  /** The weekend, a WORKDAY.INTL code kept in `literals` with no socket (`WeekendPick`). */
  static savedFields: ReadonlySet<string> = new Set(["weekend_code"]);
  static socketDocs: Record<string, string> = {
    schedule: "A scheduled project, the rows a Schedule node worked out. A Project column becomes the section bands.",
    baseline: "A second scheduled project, drawn as ghost bars behind the bars. Rows match by task name.",
    holidays: "Dates to shade as non-working, alongside the weekend.",
    status: "The status line. Unwired, no line.",
    options: "View options as key=value pairs, semicolon separated: zoom=week;critical=on;window=1-Jun,31-Aug. Help lists every key under Plans.",
    chart: "The Gantt figure: bars, milestones, dependency arrows and the critical path.",
  };

  label: string;
  literals: Record<string, number> = { ...GANTT_DEFAULT_LITERALS };
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | SolError | null = null;
  width = 240;
  height = 220;

  constructor(init?: { label?: string }) {
    super("Gantt");
    this.label = init?.label ?? "Gantt";
    this.addInput("schedule", cubeIn("Schedule"));
    this.addInput("baseline", cubeIn("Baseline"));
    this.addInput("holidays", dateListIn("Holidays"));
    this.addInput("status", dateIn("Status date"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError | null } {
    return nodeOnCore(this, inputs) as { chart: ChartValue | SolError | null };
  }
}
