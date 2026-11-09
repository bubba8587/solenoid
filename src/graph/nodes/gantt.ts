// [[C69]], [[C70]], [[C71]]
import { GraphNode } from "../graphModel";
import { cubeIn, strIn, numIn, dateIn, dateListIn, chartOut } from "./shared";
import { type ChartOptions } from "./chartOptions";
import { type SolError } from "../errorValue";
import type { ChartValue } from "../chartValue";
import { nodeOnCore } from "../nodeOnCore";


export const GANTT_DEFAULT_LITERALS: Readonly<Record<string, number>> = { weekend_code: 1 };

export class GanttNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    schedule: "A scheduled project, the rows a Schedule node worked out. A Project column becomes the section bands.",
    baseline: "A second scheduled project, drawn as ghost bars behind the bars. Rows match by task name.",
    holidays: "Dates to shade as non-working, alongside the weekend.",
    weekend_code: "Which days shade as the weekend. Excel: WORKDAY.INTL codes, 1 = Sat+Sun, 2 = Sun+Mon, 11 to 17 = a single day off.",
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
    this.addInput("weekend_code", numIn("Weekend"));
    this.addInput("status", dateIn("Status date"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError | null } {
    return nodeOnCore(this, inputs) as { chart: ChartValue | SolError | null };
  }
}
