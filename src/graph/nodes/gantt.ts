import { ClassicPreset } from "rete";
import { cubeIn, strIn, numIn, dateListIn, chartOut, readInput } from "./shared";
import { parseChartOptions, type ChartOptions } from "./chartOptions";
import { isCubeValue, isFrameValue, type CubeValue, type FrameValue } from "../frame";
import { isSolError, type SolError } from "../errorValue";
import type { ChartValue } from "../chartValue";
import { ganttPayloadFromSchedule } from "../ganttPayload";
import { todaySerial } from "./schedule";

// The Gantt figure node: a scheduled cube (or frame) in, a `chart` value of kind
// "gantt" out. It computes NO dates of its own — a Schedule node upstream already
// appended Start/Finish/Float/Critical, and ganttPayloadFromSchedule reads those
// columns into the figure's data payload. Holidays + Weekend follow the Schedule
// node's calendar vocabulary and only shade the non-working days. The card carries
// the [Chart] chip; the figure draws in the Display, the popup and a Report.

export class GanttNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    schedule: "A scheduled project: the rows a Schedule node output, with Start, Finish, Float and Critical filled in. Task is the name column, Duration is in days, and Predecessors is a list cell naming the tasks that must finish first. A Project column becomes the section bands.",
    baseline: "A second scheduled project drawn as ghost bars behind the bars, to compare a plan against where it started. Rows match by task name.",
    holidays: "Dates to shade as non-working, alongside the weekend.",
    weekend_code: "Excel's WORKDAY.INTL codes for which days shade as the weekend: 1 = Sat+Sun, 2 = Sun+Mon, … 7 = Fri+Sat; 11–17 = a single day off.",
    options: "zoom=week;tiers=2;critical=on;baseline=on;arrows=on;today=on;weekends=on;labels=on. zoom is day, week, month, quarter or year; window=1-Jun,31-Aug frames the dates; collapse=1 folds nesting; columns=name,start,finish,duration picks the grid columns. title and fontsize also apply.",
    chart: "The Gantt figure: the scheduled bars, the milestones, the dependency arrows and the critical path. It draws at full size in the Display, the popup, or a Report.",
  };

  label: string;
  literals: Record<string, number> = { weekend_code: 1 };
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
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: {
    schedule?: (CubeValue | FrameValue | SolError | null)[];
    baseline?: (CubeValue | FrameValue | SolError | null)[];
    holidays?: (number | null)[][];
    weekend_code?: number[];
    options?: string[];
  }): { chart: ChartValue | SolError | null } {
    const schedule = inputs.schedule?.[0] ?? null;
    // Options parse the same string twice: the chart keys here, the gantt view keys
    // inside ganttPayloadFromSchedule. A wired blank means "none given".
    const optIn = readInput(inputs.options, this.stringLiterals.options ?? null);
    const optStr = typeof optIn === "string" || optIn === null ? optIn : (this.stringLiterals.options ?? null);
    this.chartOptions = parseChartOptions(optStr);

    // A whole-graph scheduling failure arrives as one SolError on the cube; carry it through.
    if (isSolError(schedule)) { this.cachedChart = schedule; return { chart: schedule }; }
    if (!isCubeValue(schedule) && !isFrameValue(schedule)) { this.cachedChart = null; return { chart: null }; }

    const baseIn = inputs.baseline?.[0] ?? null;
    const baseline = isCubeValue(baseIn) || isFrameValue(baseIn) ? baseIn : null;
    const weekendCode = readInput(inputs.weekend_code, this.literals.weekend_code ?? 1) ?? 1;

    const payload = ganttPayloadFromSchedule(schedule, {
      baseline,
      today: todaySerial(),
      options: optStr,
      calendar: { holidays: inputs.holidays?.[0], weekendCode },
    });
    if (isSolError(payload)) { this.cachedChart = payload; return { chart: payload }; }

    const chart: ChartValue = {
      __chart: true, op: "gantt", values: null, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Gantt",
    };
    this.cachedChart = chart;
    return { chart };
  }
}
