// [[C100]] chartIsAValue
// Where a Heatmap's grid, labels and colorbar sit at a given size. Pure: the canvas view measures text and draws.

export interface HeatLayout {
  /** The grid's top left corner and cell size; `lower` puts row 0 at the bottom. */
  gx: number; gy: number; cw: number; ch: number;
  nR: number; nC: number;
  lower: boolean;
  lineH: number;
  /** Row labels right-align at `x`, `w` wide, every `step`th drawn. */
  rowLabels: { x: number; w: number; step: number } | null;
  /** Column labels hang from `y`, `h` deep; rotated ones read bottom to top. */
  colLabels: { y: number; h: number; rotated: boolean; step: number } | null;
  cbar: { x: number; y: number; w: number; h: number; textX: number } | null;
  xlabel: { x: number; y: number } | null;
  ylabel: { x: number; y: number } | null;
  note: { x: number; y: number } | null;
}

export interface HeatLayoutInput {
  nR: number; nC: number;
  W: number; H: number; fs: number;
  /** The widest row label, column label and colorbar tick, in pixels at the tick font. */
  rowLabelW: number; colLabelW: number; cbarTickW: number;
  xlabel: boolean; ylabel: boolean; cbar: boolean;
  aspect: "equal" | "auto";
  lower: boolean;
  note: boolean;
}

const GAP = 3;

export function heatmapLayout(a: HeatLayoutInput): HeatLayout {
  const { nR, nC, W, H, fs } = a;
  const lineH = Math.ceil(10.5 * fs);
  const padT = Math.ceil(5 * fs), padB = 1, padR = 1;
  const ylabelW = a.ylabel ? lineH + 2 : 0;
  const xlabelH = a.xlabel ? lineH + 2 : 0;
  const noteH = a.note ? lineH : 0;
  const rowLabW = a.rowLabelW > 0 ? Math.min(a.rowLabelW, W * 0.28) + GAP : 0;
  const cbarW = a.cbar ? 6 + 8 + 3 + a.cbarTickW : 0;
  const availW = Math.max(1, W - ylabelW - rowLabW - cbarW - padR);
  const fit = (availH: number) => a.aspect === "equal"
    ? { cw: Math.min(availW / nC, availH / nR), ch: Math.min(availW / nC, availH / nR) }
    : { cw: availW / nC, ch: availH / nR };

  const flatH = a.colLabelW > 0 ? lineH + GAP : 0;
  const first = fit(Math.max(1, H - padT - flatH - xlabelH - noteH - padB));
  const rotated = a.colLabelW > 0 && a.colLabelW > first.cw - 2;
  const colH = !a.colLabelW ? 0 : rotated ? Math.min(a.colLabelW, H * 0.3) + GAP + 1 : flatH;
  const { cw, ch } = fit(Math.max(1, H - padT - colH - xlabelH - noteH - padB));

  const gridW = cw * nC, gridH = ch * nR;
  const blockW = ylabelW + rowLabW + gridW + cbarW;
  const blockH = padT + gridH + colH + xlabelH + noteH;
  const x0 = Math.max(0, (W - blockW) / 2);
  const y0 = Math.max(0, (H - blockH) / 2);
  const gx = x0 + ylabelW + rowLabW;
  const gy = y0 + padT;
  const below = gy + gridH + colH;
  const labelStep = (cell: number) => Math.max(1, Math.ceil((lineH * 0.9) / Math.max(cell, 1e-6)));

  return {
    gx, gy, cw, ch, nR, nC, lower: a.lower, lineH,
    rowLabels: rowLabW > 0 ? { x: gx - GAP, w: rowLabW - GAP, step: labelStep(ch) } : null,
    colLabels: colH > 0 ? { y: gy + gridH + GAP, h: colH - GAP - 1, rotated, step: rotated ? labelStep(cw) : 1 } : null,
    cbar: a.cbar ? { x: gx + gridW + 6, y: gy, w: 8, h: gridH, textX: gx + gridW + 6 + 8 + 3 } : null,
    xlabel: a.xlabel ? { x: gx + gridW / 2, y: below + xlabelH / 2 } : null,
    ylabel: a.ylabel ? { x: x0 + lineH / 2, y: gy + gridH / 2 } : null,
    note: a.note ? { x: gx + gridW + cbarW, y: below + xlabelH + noteH / 2 } : null,
  };
}

/** The cell under a point, as payload indices, or null off the grid. */
export function heatCellAt(l: HeatLayout, x: number, y: number): { r: number; c: number } | null {
  const c = Math.floor((x - l.gx) / l.cw);
  const vr = Math.floor((y - l.gy) / l.ch);
  if (!(c >= 0 && c < l.nC && vr >= 0 && vr < l.nR)) return null;
  return { r: l.lower ? l.nR - 1 - vr : vr, c };
}

/** The top edge of payload row `r` on screen. */
export function heatRowY(l: HeatLayout, r: number): number {
  return l.gy + (l.lower ? l.nR - 1 - r : r) * l.ch;
}
