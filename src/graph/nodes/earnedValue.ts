import { ClassicPreset } from "rete";
import { cubeIn, dateIn, dateListIn, strIn, numIn, frameOut, numOut, readInput } from "./shared";
import { isCubeValue, isFrameValue, frameToCube, type CubeValue, type FrameValue, type CubeColumn, type CubeCell, type FrameCell } from "../frame";
import { isUnitCell, type ColumnUnit } from "../unitValue";
import { displayMagnitudeOf } from "../unitBridge";
import { tagFrameCellUnit } from "../unitColumn";
import { isSolError, solError, type SolError } from "../errorValue";
import { earnedValue, type EvTaskInput } from "./earnedValueOps";
import { todaySerial } from "./schedule";
import { Calendar } from "@solenoid/schedule-engine";
import type { Shape } from "../frameShape";
import type { FrameHint } from "../frameHint";

// The Earned Value node (Table verbs › Plan): a scheduled cube + its baseline + a status
// date → an EVM summary. The math is the pure earnedValueOps; this class reads the cube
// columns, joins the baseline by name, carries the Cost column's currency onto the money
// columns (firstClassUnits), and returns the Summary frame plus SPI / CPI / EAC totals.

const norm = (s: string) => s.trim().toLowerCase();
const isText = (v: unknown): v is string => typeof v === "string";

function byName(c: CubeValue, ...names: string[]): CubeColumn | undefined {
  const set = new Set(names.map(norm));
  return c.columns.find((col) => set.has(norm(col.name)));
}
/** A cost/number cell's magnitude in its own display unit (a UnitCell) or as-is; blank → 0. */
function magnitude(cell: CubeCell | undefined): number {
  if (isUnitCell(cell)) return displayMagnitudeOf(cell);
  return typeof cell === "number" && Number.isFinite(cell) ? cell : 0;
}
const dateOf = (cell: CubeCell | undefined): number | null => (typeof cell === "number" && Number.isFinite(cell) ? cell : null);
/** The Cost column's unit, from the first united cell — null when the costs are bare numbers. */
function unitOf(col: CubeColumn | undefined): ColumnUnit | undefined {
  const uc = col?.cells.find(isUnitCell);
  return uc ? { dim: uc.dim, ...(uc.display ? { display: uc.display } : {}) } : undefined;
}

const SUMMARY_COLS = ["BCWS", "BCWP", "ACWP", "SV", "CV", "SPI", "CPI", "EAC", "VAC", "TCPI"] as const;
const RATIO_COLS = new Set(["SPI", "CPI", "TCPI"]);

export class EarnedValueNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    schedule: "A scheduled project with a Cost column and Complete from 0 to 100. An Actual cost column is the real spend; without one it equals the earned value.",
    baseline: "The plan as it started: its Cost is the budget, its Start and Finish the planned pace. Rows match by task name. Unwired, the schedule is its own baseline.",
    status: "The day progress is measured on. Unwired, today.",
    holidays: "Dates to skip when measuring planned progress, alongside the weekend.",
    weekend_code: "Which days are the weekend. Excel: WORKDAY.INTL codes, 1 = Sat+Sun, 2 = Sun+Mon, 11 to 17 = a single day off.",
    cost: "The Cost column's name, when it isn't called Cost, Budget or BAC.",
    frame: "A row per task: planned value BCWS, earned value BCWP, actual cost ACWP, the variances SV and CV, the indices SPI and CPI, the estimate at completion EAC, then VAC and TCPI.",
    spi: "The project schedule performance index: earned over planned value.",
    cpi: "The project cost performance index: earned value over actual cost.",
    eac: "The estimate at completion: the budget over the cost performance index.",
  };

  label: string;
  // The Cost column arrives as UnitCells, so the per-input unit strip must be OFF or the
  // currency the money columns carry would be gone before data() runs (perInputUnitBlind).
  unitAware = true;
  literals: Record<string, number> = { weekend_code: 1 };
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

  /** The Summary frame is fixed-shape (Task + the EVM columns), so downstream pickers see it. */
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

  private empty(v: FrameValue | SolError | null) {
    this.cachedResult = v; this.cachedSpi = isSolError(v) ? v : null; this.cachedCpi = isSolError(v) ? v : null; this.cachedEac = isSolError(v) ? v : null;
    return { frame: v, spi: this.cachedSpi, cpi: this.cachedCpi, eac: this.cachedEac };
  }

  data(inputs: {
    schedule?: (CubeValue | FrameValue | SolError | null)[];
    baseline?: (CubeValue | FrameValue | SolError | null)[];
    status?: (number | null)[];
    holidays?: (number | null)[][];
    weekend_code?: number[];
    cost?: string[];
  }) {
    const sched = inputs.schedule?.[0] ?? null;
    if (isSolError(sched)) return this.empty(sched);
    const scube = isCubeValue(sched) ? sched : isFrameValue(sched) ? frameToCube(sched) : null;
    if (!scube) return this.empty(null);
    // A wired blank status is "no status yet"; unwired = today.
    const status = inputs.status ? inputs.status[0] : todaySerial();
    if (status == null || !Number.isFinite(status)) return this.empty(null);

    const baseRaw = inputs.baseline?.[0] ?? null;
    const bcube = isCubeValue(baseRaw) ? baseRaw : isFrameValue(baseRaw) ? frameToCube(baseRaw) : null;
    const costName = (readInput(inputs.cost, this.stringLiterals.cost ?? "") ?? "").trim();

    const taskCol = byName(scube, "task", "name", "title") ?? scube.columns.find((c) => c.cells.some(isText));
    if (!taskCol) return this.empty(solError("#VALUE!", "Earned Value needs a Task column naming each task"));
    const completeCol = byName(scube, "complete", "% complete", "percent complete", "done", "progress");
    const costCol = (costName ? byName(scube, costName) : undefined) ?? byName(scube, "cost", "budget", "bac");
    const actualCol = byName(scube, "actual cost", "actual", "acwp", "spent");
    const sStart = byName(scube, "start"), sFinish = byName(scube, "finish", "end");

    const bTask = bcube ? (byName(bcube, "task", "name", "title") ?? bcube.columns.find((c) => c.cells.some(isText))) : undefined;
    const bCost = bcube ? ((costName ? byName(bcube, costName) : undefined) ?? byName(bcube, "cost", "budget", "bac")) : undefined;
    const bStart = bcube ? byName(bcube, "start") : undefined, bFinish = bcube ? byName(bcube, "finish", "end") : undefined;
    const baseIdx = new Map<string, number>();
    bTask?.cells.forEach((v, i) => { const n = norm(String(v ?? "")); if (n && !baseIdx.has(n)) baseIdx.set(n, i); });

    const costUnit = unitOf(costCol) ?? unitOf(bCost);
    const rows = scube.columns.reduce((m, c) => Math.max(m, c.cells.length), 0);
    const tasks: EvTaskInput[] = [];
    for (let i = 0; i < rows; i++) {
      const name = String(taskCol.cells[i] ?? "").trim();
      if (!name) continue;
      const bi = baseIdx.get(norm(name));
      // The baseline cost is the budget (BAC); without a baseline row, the schedule's own Cost.
      const baseCost = bi != null && bCost ? magnitude(bCost.cells[bi]) : null;
      const cost = baseCost != null ? baseCost : (costCol ? magnitude(costCol.cells[i]) : 0);
      const complete = Math.max(0, Math.min(100, completeCol ? magnitude(completeCol.cells[i]) : 0));
      const plannedStart = bi != null && bStart ? dateOf(bStart.cells[bi]) : dateOf(sStart?.cells[i]);
      const plannedFinish = bi != null && bFinish ? dateOf(bFinish.cells[bi]) : dateOf(sFinish?.cells[i]);
      const actualCost = actualCol && actualCol.cells[i] != null ? magnitude(actualCol.cells[i]) : null;
      tasks.push({ name, cost, complete, plannedStart, plannedFinish, actualCost });
    }

    // The planned fraction counts working days on the same calendar the schedule used, so a
    // holiday inside a task's span doesn't count as planned progress (anchor is irrelevant to
    // countBetween — it returns an index difference).
    const weekendCode = readInput(inputs.weekend_code, this.literals.weekend_code ?? 1) ?? 1;
    const calendar = new Calendar(status, { workingDays: true, weekendCode, holidays: inputs.holidays?.[0] ?? undefined, precision: "days" });
    const { tasks: rowsM, totals } = earnedValue(tasks, status, (a, b) => calendar.countBetween(a, b));
    const money = costUnit ? { unit: costUnit } : {};
    const col = (name: string, values: FrameCell[]) => ({ name, type: "number" as const, values, ...(RATIO_COLS.has(name) ? {} : money) });
    const frame: FrameValue = {
      __frame: true,
      columns: [
        { name: "Task", type: "string", values: rowsM.map((r) => r.name) },
        col("BCWS", rowsM.map((r) => r.bcws)),
        col("BCWP", rowsM.map((r) => r.bcwp)),
        col("ACWP", rowsM.map((r) => r.acwp)),
        col("SV", rowsM.map((r) => r.sv)),
        col("CV", rowsM.map((r) => r.cv)),
        col("SPI", rowsM.map((r) => r.spi)),
        col("CPI", rowsM.map((r) => r.cpi)),
        col("EAC", rowsM.map((r) => r.eac)),
        col("VAC", rowsM.map((r) => r.vac)),
        col("TCPI", rowsM.map((r) => r.tcpi)),
      ],
    };
    // EAC is money, so it carries the unit on the scalar output too; the indices are ratios.
    const eacOut: FrameCell = costUnit ? (tagFrameCellUnit(totals.eac, costUnit) as FrameCell) : totals.eac;
    this.cachedResult = frame; this.cachedSpi = totals.spi; this.cachedCpi = totals.cpi; this.cachedEac = eacOut;
    return { frame, spi: totals.spi, cpi: totals.cpi, eac: eacOut };
  }
}
