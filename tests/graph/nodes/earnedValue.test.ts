import { describe, it, expect } from "vitest";
import { EarnedValueNode } from "../../../src/graph/rete-nodes";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";
import { cubeFromColumns, isFrameValue, type FrameValue, type CubeCell } from "../../../src/graph/frame";
import { columnUnitFromSpec, tagFrameCellUnit } from "../../../src/graph/unitColumn";
import { isUnitCell } from "../../../src/graph/unitValue";
import { isSolError } from "../../../src/graph/errorValue";

const d = (iso: string) => parseDateToSerial(iso);
const col = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)!;

describe("EarnedValueNode", () => {
  it("produces the EVM Summary frame and the SPI/CPI/EAC totals", () => {
    const sched = cubeFromColumns([
      { name: "Task", cells: ["A", "B"], type: "string" },
      { name: "Cost", cells: [1000, 2000], type: "number" },
      { name: "Complete", cells: [100, 50], type: "number" },
      { name: "Start", cells: [d("2026-01-05"), d("2026-01-07")], type: "date" },
      { name: "Finish", cells: [d("2026-01-06"), d("2026-01-09")], type: "date" },
    ]);
    const out = new EarnedValueNode().data({ schedule: [sched], status: [d("2026-01-08")] });
    if (!isFrameValue(out.frame)) throw new Error("expected a frame");
    expect(out.frame.columns.map((c) => c.name)).toEqual(["Task", "BCWS", "BCWP", "ACWP", "SV", "CV", "SPI", "CPI", "EAC", "VAC", "TCPI"]);
    expect(col(out.frame, "BCWP").values).toEqual([1000, 1000]); // A 100%, B 50%
    expect(out.cpi).toBe(1);   // no actuals → ACWP = BCWP everywhere
    expect(out.eac).toBe(3000); // ΣBAC / CPI
    expect(typeof out.spi).toBe("number");
  });

  it("joins the baseline by name for the budget and the planned pace", () => {
    const sched = cubeFromColumns([
      { name: "Task", cells: ["A"], type: "string" },
      { name: "Complete", cells: [50], type: "number" },
    ]);
    const baseline = cubeFromColumns([
      { name: "Task", cells: ["A"], type: "string" },
      { name: "Cost", cells: [1000], type: "number" },
      { name: "Start", cells: [d("2026-01-05")], type: "date" },
      { name: "Finish", cells: [d("2026-01-09")], type: "date" },
    ]);
    const out = new EarnedValueNode().data({ schedule: [sched], baseline: [baseline], status: [d("2026-01-08")] });
    if (!isFrameValue(out.frame)) throw new Error("expected a frame");
    expect(col(out.frame, "BCWP").values).toEqual([500]); // baseline cost 1000 × 50%
  });

  it("carries the Cost column's currency onto the money columns but not the indices", () => {
    const usd = columnUnitFromSpec("$");
    if (!usd) throw new Error("no usd unit");
    const sched = cubeFromColumns([
      { name: "Task", cells: ["A"], type: "string" },
      { name: "Cost", cells: [tagFrameCellUnit(1000, usd) as CubeCell] },
      { name: "Complete", cells: [50], type: "number" },
    ]);
    const out = new EarnedValueNode().data({ schedule: [sched], status: [d("2026-01-08")] });
    if (!isFrameValue(out.frame)) throw new Error("expected a frame");
    expect(col(out.frame, "BCWP").unit).toBeTruthy();       // money column keeps the currency
    expect(col(out.frame, "SPI").unit).toBeUndefined();     // an index is unitless
    expect(col(out.frame, "BCWP").values[0]).toBe(500);     // 1000 × 50%, in display units
    expect(isUnitCell(out.eac)).toBe(true);                 // the EAC scalar carries the unit too
  });

  it("a holiday inside the baseline span lowers the planned value (BCWS)", () => {
    const sched = cubeFromColumns([
      { name: "Task", cells: ["A"], type: "string" },
      { name: "Cost", cells: [1000], type: "number" },
      { name: "Complete", cells: [0], type: "number" },
      { name: "Start", cells: [d("2026-01-05")], type: "date" },   // Mon
      { name: "Finish", cells: [d("2026-01-09")], type: "date" },  // Fri
    ]);
    const status = d("2026-01-07"); // Wed
    const plain = new EarnedValueNode().data({ schedule: [sched], status: [status] });
    const withHol = new EarnedValueNode().data({ schedule: [sched], status: [status], holidays: [[d("2026-01-06")]] }); // Tue off
    if (!isFrameValue(plain.frame) || !isFrameValue(withHol.frame)) throw new Error("expected frames");
    expect(col(plain.frame, "BCWS").values[0]).toBeCloseTo(600, 6);   // 3 of 5 working days elapsed
    expect(col(withHol.frame, "BCWS").values[0]).toBeCloseTo(500, 6); // Tue skipped: 2 of 4
  });

  it("nulls without a cube; a Task-less cube is a #VALUE!", () => {
    expect(new EarnedValueNode().data({}).frame).toBeNull();
    const noTask = cubeFromColumns([{ name: "Cost", cells: [1], type: "number" }]);
    const out = new EarnedValueNode().data({ schedule: [noTask], status: [d("2026-01-08")] });
    expect(isSolError(out.frame) && out.frame.code).toBe("#VALUE!");
  });
});
