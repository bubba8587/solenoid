import { describe, it, expect } from "vitest";
import { gridKeyOf, nextCell, type GridKey } from "./components/gridKeyboard";

const ev = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
  ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("gridKeyOf — which keydowns are ours", () => {
  it("maps the movement keys, using Shift for the Enter/Tab variant", () => {
    expect(gridKeyOf(ev("Enter"))).toBe("Enter");
    expect(gridKeyOf(ev("Enter", { shiftKey: true }))).toBe("ShiftEnter");
    expect(gridKeyOf(ev("Tab"))).toBe("Tab");
    expect(gridKeyOf(ev("Tab", { shiftKey: true }))).toBe("ShiftTab");
    expect(gridKeyOf(ev("ArrowUp"))).toBe("ArrowUp");
    expect(gridKeyOf(ev("ArrowDown"))).toBe("ArrowDown");
    expect(gridKeyOf(ev("ArrowLeft"))).toBe("ArrowLeft");
    expect(gridKeyOf(ev("ArrowRight"))).toBe("ArrowRight");
    expect(gridKeyOf(ev("Home"))).toBe("Home");
    expect(gridKeyOf(ev("End"))).toBe("End");
  });

  it("declines a non-Shift modifier and unknown keys", () => {
    expect(gridKeyOf(ev("Enter", { ctrlKey: true }))).toBeNull();
    expect(gridKeyOf(ev("ArrowDown", { altKey: true }))).toBeNull();
    expect(gridKeyOf(ev("Tab", { metaKey: true }))).toBeNull();
    expect(gridKeyOf(ev("a"))).toBeNull();
    expect(gridKeyOf(ev("Escape"))).toBeNull();
  });
});

describe("nextCell — movement on a 3×3, no computed cells", () => {
  const dims = { rows: 3, cols: 3 };
  const noSkip = () => false;
  const at = (key: GridKey, vi: number, c: number) => nextCell(key, { vi, c }, dims, noSkip);

  it("Enter/ShiftEnter step down/up one row, clamped", () => {
    expect(at("Enter", 0, 1)).toEqual({ vi: 1, c: 1 });
    expect(at("Enter", 2, 1)).toEqual({ vi: 2, c: 1 }); // clamp at the last row
    expect(at("ShiftEnter", 1, 1)).toEqual({ vi: 0, c: 1 });
    expect(at("ShiftEnter", 0, 1)).toEqual({ vi: 0, c: 1 }); // clamp at the first row
  });

  it("arrows step and clamp, never null", () => {
    expect(at("ArrowDown", 0, 0)).toEqual({ vi: 1, c: 0 });
    expect(at("ArrowDown", 2, 0)).toEqual({ vi: 2, c: 0 });
    expect(at("ArrowUp", 0, 0)).toEqual({ vi: 0, c: 0 });
    expect(at("ArrowRight", 0, 2)).toEqual({ vi: 0, c: 2 });
    expect(at("ArrowLeft", 0, 0)).toEqual({ vi: 0, c: 0 });
  });

  it("Home/End jump to the first/last column on the same row", () => {
    expect(at("Home", 1, 2)).toEqual({ vi: 1, c: 0 });
    expect(at("End", 1, 0)).toEqual({ vi: 1, c: 2 });
  });

  it("Tab walks right and wraps to the next row; null off the last cell", () => {
    expect(at("Tab", 0, 0)).toEqual({ vi: 0, c: 1 });
    expect(at("Tab", 0, 2)).toEqual({ vi: 1, c: 0 }); // wrap to the next row
    expect(at("Tab", 2, 2)).toBeNull();               // off the end → browser default
  });

  it("Shift+Tab walks left and wraps to the previous row; null off the first cell", () => {
    expect(at("ShiftTab", 0, 1)).toEqual({ vi: 0, c: 0 });
    expect(at("ShiftTab", 1, 0)).toEqual({ vi: 0, c: 2 }); // wrap to the previous row
    expect(at("ShiftTab", 0, 0)).toBeNull();              // off the start → browser default
  });
});

describe("nextCell — Tab skips computed columns, arrows don't", () => {
  const dims = { rows: 3, cols: 3 };
  const skipMiddle = (_vi: number, c: number) => c === 1; // column 1 is computed

  it("Tab hops over the skipped column", () => {
    expect(nextCell("Tab", { vi: 0, c: 0 }, dims, skipMiddle)).toEqual({ vi: 0, c: 2 });
    expect(nextCell("Tab", { vi: 0, c: 2 }, dims, skipMiddle)).toEqual({ vi: 1, c: 0 });
    expect(nextCell("ShiftTab", { vi: 0, c: 2 }, dims, skipMiddle)).toEqual({ vi: 0, c: 0 });
  });

  it("arrows still land on the skipped column (it's read-only, not unreachable)", () => {
    expect(nextCell("ArrowRight", { vi: 0, c: 0 }, dims, skipMiddle)).toEqual({ vi: 0, c: 1 });
  });
});

describe("nextCell — degenerate grids", () => {
  const noSkip = () => false;
  it("a 1×1 grid: Tab both ways is null, arrows and Enter stay put", () => {
    const d = { rows: 1, cols: 1 };
    expect(nextCell("Tab", { vi: 0, c: 0 }, d, noSkip)).toBeNull();
    expect(nextCell("ShiftTab", { vi: 0, c: 0 }, d, noSkip)).toBeNull();
    expect(nextCell("ArrowDown", { vi: 0, c: 0 }, d, noSkip)).toEqual({ vi: 0, c: 0 });
    expect(nextCell("Enter", { vi: 0, c: 0 }, d, noSkip)).toEqual({ vi: 0, c: 0 });
  });

  it("zero rows or columns → null for any key", () => {
    expect(nextCell("ArrowDown", { vi: 0, c: 0 }, { rows: 0, cols: 3 }, noSkip)).toBeNull();
    expect(nextCell("Tab", { vi: 0, c: 0 }, { rows: 3, cols: 0 }, noSkip)).toBeNull();
  });
});
