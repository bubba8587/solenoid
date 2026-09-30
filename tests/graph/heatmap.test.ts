// [[C96]] chartOptionsAreMatplotlib, [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { colormapRgb, heatScale, normalizeCmap, COLORMAP_LIST } from "../../src/graph/colormaps";
import { formatNumberSpec, isNumberSpec } from "../../src/graph/numberSpec";
import { heatmapLayout, heatCellAt, heatRowY, type HeatLayoutInput } from "../../src/graph/components/heatmapLayout";

describe("colormaps", () => {
  it("spell names as matplotlib does, any case, with _r reversing", () => {
    expect(normalizeCmap("rdbu")).toBe("RdBu");
    expect(normalizeCmap(" Viridis_R ")).toBe("viridis_r");
    expect(normalizeCmap("jet")).toBeUndefined();
    expect(COLORMAP_LIST.map((m) => m.name)).toContain("coolwarm");
  });

  it("interpolate between stops, clamp t, and run backward when reversed", () => {
    expect(colormapRgb("viridis", 0)).toEqual([0x44, 0x01, 0x54]);
    expect(colormapRgb("viridis", 1)).toEqual([0xfd, 0xe7, 0x25]);
    expect(colormapRgb("viridis", 7)).toEqual(colormapRgb("viridis", 1));
    expect(colormapRgb("viridis_r", 0)).toEqual(colormapRgb("viridis", 1));
    expect(colormapRgb("Greys", 0.5)).toEqual([0x96, 0x96, 0x96]);
    expect(colormapRgb("nope", 0.5)).toBeNull();
  });
});

describe("heatScale", () => {
  it("spans the data, or vmin and vmax when given", () => {
    const s = heatScale(2, 12, {});
    expect([s.lo, s.hi, s.t(2), s.t(7), s.t(12), s.t(99)]).toEqual([2, 12, 0, 0.5, 1, 1]);
    const p = heatScale(2, 12, { vmin: 0, vmax: 20 });
    expect(p.t(5)).toBe(0.25);
    expect(heatScale(4, 4, {}).t(4)).toBe(0.5);
  });

  it("puts center at the middle with one color step per unit on both sides", () => {
    const s = heatScale(-2, 8, { center: 0 });
    expect([s.lo, s.hi, s.center]).toEqual([-8, 8, 0]);
    expect(s.t(0)).toBe(0.5);
    expect(s.t(8)).toBe(1);
    expect(s.t(-2)).toBe(0.375);
    const pinned = heatScale(-2, 8, { center: 0, vmin: -1, vmax: 4 });
    expect([pinned.lo, pinned.hi]).toEqual([-1, 4]);
    expect(pinned.t(4)).toBe(1);
    expect(pinned.t(-1)).toBe(0.375);
  });
});

describe("fmt, Python's format spec", () => {
  it("formats fixed, percent, exponent, integer and general", () => {
    expect(formatNumberSpec(3.14159, ".2f")).toBe("3.14");
    expect(formatNumberSpec(1234567.891, ",.0f")).toBe("1,234,568");
    expect(formatNumberSpec(0.256, ".1%")).toBe("25.6%");
    expect(formatNumberSpec(12345, ".2e")).toBe("1.23e+04");
    expect(formatNumberSpec(2.6, "d")).toBe("3");
    expect(formatNumberSpec(0.123456, ".2g")).toBe("0.12");
    expect(formatNumberSpec(123456, ".2g")).toBe("1.2e+05");
    expect(formatNumberSpec(0.00001234, "g")).toBe("1.234e-05");
    expect(formatNumberSpec(5, "+.1f")).toBe("+5.0");
    expect(formatNumberSpec(-5, "+.1f")).toBe("-5.0");
  });

  it("rejects what it does not read", () => {
    expect(isNumberSpec("{:.2f}")).toBe(false);
    expect(isNumberSpec("")).toBe(false);
    expect(isNumberSpec(".3")).toBe(true);
    expect(formatNumberSpec(1, "abc")).toBeNull();
  });
});

describe("heatmapLayout", () => {
  const base: HeatLayoutInput = {
    nR: 3, nC: 4, W: 300, H: 200, fs: 1,
    rowLabelW: 30, colLabelW: 12, cbarTickW: 20,
    xlabel: false, ylabel: false, cbar: true, aspect: "equal", lower: false, note: false,
  };

  it("draws square cells by default, and fills the plot with aspect auto", () => {
    const sq = heatmapLayout(base);
    expect(sq.cw).toBe(sq.ch);
    const auto = heatmapLayout({ ...base, aspect: "auto" });
    expect(auto.cw).not.toBe(auto.ch);
    expect(auto.ch).toBeGreaterThan(sq.ch);
  });

  it("keeps the grid, labels and colorbar inside the figure", () => {
    for (const a of [base, { ...base, nR: 40, nC: 2, colLabelW: 80, xlabel: true, ylabel: true, note: true }]) {
      const l = heatmapLayout(a);
      expect(l.gx - (l.rowLabels?.w ?? 0)).toBeGreaterThanOrEqual(0);
      expect(l.gy).toBeGreaterThanOrEqual(0);
      expect(l.cbar!.textX + a.cbarTickW).toBeLessThanOrEqual(a.W + 0.001);
      expect(l.gy + l.ch * a.nR).toBeLessThanOrEqual(a.H);
    }
  });

  it("turns column labels upright when they are wider than a cell, and thins crowded labels", () => {
    const wide = heatmapLayout({ ...base, nC: 20, colLabelW: 60 });
    expect(wide.colLabels!.rotated).toBe(true);
    expect(heatmapLayout(base).colLabels!.rotated).toBe(false);
    const tall = heatmapLayout({ ...base, nR: 200 });
    expect(tall.rowLabels!.step).toBeGreaterThan(1);
  });

  it("drops the colorbar gutter when cbar is off", () => {
    const off = heatmapLayout({ ...base, cbar: false, aspect: "auto" });
    expect(off.cbar).toBeNull();
    expect(off.cw).toBeGreaterThan(heatmapLayout({ ...base, aspect: "auto" }).cw);
  });

  it("finds the cell under a point, row 0 at the bottom with origin lower", () => {
    const l = heatmapLayout(base);
    const inCell = (r: number, c: number) => [l.gx + (c + 0.5) * l.cw, heatRowY(l, r) + l.ch / 2] as const;
    expect(heatCellAt(l, ...inCell(1, 2))).toEqual({ r: 1, c: 2 });
    expect(heatCellAt(l, l.gx - 1, l.gy + 1)).toBeNull();
    const low = heatmapLayout({ ...base, lower: true });
    expect(heatRowY(low, 0)).toBeGreaterThan(heatRowY(low, 2));
    expect(heatCellAt(low, low.gx + 1, heatRowY(low, 0) + 1)).toEqual({ r: 0, c: 0 });
  });
});
