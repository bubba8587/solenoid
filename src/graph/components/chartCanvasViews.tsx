import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor } from "../palette";
import { serialToJsDate } from "../nodes/date";
import { heightColor } from "./SurfaceView";
import type {
  WaterfallPayload, CandlePayload, BoxplotPayload, CalHeatPayload,
  WafflePayload, QuiverPayload, ContourPayload,
} from "../chartValue";

// Canvas figure views: one DOM element regardless of data size, themed by reading the live
// CSS vars at draw time (the components subscribe to appThemeStore so a flip redraws).

type Ctx = CanvasRenderingContext2D;

/** Supersampled 2D context: render above device resolution, let the browser downscale. */
function setupCanvas(canvas: HTMLCanvasElement, W: number, H: number): Ctx | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const scale = Math.min(4, (window.devicePixelRatio || 1) * 2);
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = "round";
  return ctx;
}

/** Theme colors resolved once per draw, off the canvas's computed style. */
function themeInk(canvas: HTMLCanvasElement) {
  const cs = getComputedStyle(canvas);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    text: v("--text", "#ccc"),
    dim: v("--text-dim", "#888"),
    border: v("--border-strong", "#555"),
    sunken: v("--surface-sunken", "#2a2a2a"),
    up: resolveColor("green"),
    down: resolveColor("vermilion"),
    accent: v("--accent", resolveColor("sky")),
    neutral: resolveColor("blue"),
  };
}

const TICK_FONT = "500 8.5px system-ui, sans-serif";

/** Compact tick label: 3 significant digits, K/M/B above a thousand. */
function fmtTick(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${trim3(n / 1e9)}B`;
  if (a >= 1e6) return `${trim3(n / 1e6)}M`;
  if (a >= 1e3) return `${trim3(n / 1e3)}K`;
  return trim3(n);
}
function trim3(n: number): string {
  return String(Number(n.toPrecision(3)));
}

/** Left-axis gridlines + ticks over [lo, hi] mapped by sy; returns the plot-left x. */
function drawYAxis(ctx: Ctx, ink: ReturnType<typeof themeInk>, lo: number, hi: number, sy: (v: number) => number, x0: number, x1: number) {
  ctx.font = TICK_FONT;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks = 3;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    const y = sy(v);
    ctx.strokeStyle = ink.border;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = ink.dim;
    ctx.fillText(fmtTick(v), x0 - 3, y);
  }
  ctx.globalAlpha = 1;
}

/** Truncate a label to fit `max` px with an ellipsis. */
function fitLabel(ctx: Ctx, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Padded value range (never zero-span). */
function span(lo: number, hi: number): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

// ─── Waterfall ─────────────────────────────────────────────────────────────────

function drawWaterfall(canvas: HTMLCanvasElement, p: WaterfallPayload, W: number, H: number) {
  const ctx = setupCanvas(canvas, W, H);
  if (!ctx) return;
  const ink = themeInk(canvas);
  const n = p.values.length;
  if (n === 0) return;
  // Running totals: bar i spans [cum, cum + v]; the Total bar spans [0, sum].
  const bars: Array<{ name: string; a: number; b: number; kind: "up" | "down" | "total" }> = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const v = p.values[i];
    bars.push({ name: p.names[i] ?? "", a: cum, b: cum + v, kind: v >= 0 ? "up" : "down" });
    cum += v;
  }
  if (p.total) bars.push({ name: "Total", a: 0, b: cum, kind: "total" });

  let lo = 0, hi = 0;
  for (const b of bars) { lo = Math.min(lo, b.a, b.b); hi = Math.max(hi, b.a, b.b); }
  [lo, hi] = span(lo, hi);
  const padL = 30, padR = 4, padT = 4, padB = 14;
  const sy = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  drawYAxis(ctx, ink, lo, hi, sy, padL, W - padR);

  const plotW = W - padL - padR;
  const bw = plotW / bars.length;
  const barW = Math.max(3, bw * 0.66);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const x = padL + i * bw + (bw - barW) / 2;
    const yA = sy(b.a), yB = sy(b.b);
    ctx.fillStyle = b.kind === "up" ? ink.up : b.kind === "down" ? ink.down : ink.neutral;
    ctx.fillRect(x, Math.min(yA, yB), barW, Math.max(1, Math.abs(yB - yA)));
    if (i < bars.length - 1) {
      const yEnd = b.kind === "total" ? yB : sy(b.b);
      ctx.strokeStyle = ink.dim;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 0.75;
      ctx.beginPath(); ctx.moveTo(x + barW, yEnd); ctx.lineTo(padL + (i + 1) * bw + (bw - barW) / 2, yEnd); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (bw >= 20) {
      ctx.font = TICK_FONT;
      ctx.fillStyle = ink.dim;
      ctx.fillText(fitLabel(ctx, b.name, bw - 2), padL + i * bw + bw / 2, H - padB + 3);
    }
  }
  // Zero line, over the bars so the baseline stays legible.
  ctx.strokeStyle = ink.text;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, sy(0)); ctx.lineTo(W - padR, sy(0)); ctx.stroke();
  ctx.globalAlpha = 1;
}

// ─── Candlestick ───────────────────────────────────────────────────────────────

function drawCandle(canvas: HTMLCanvasElement, p: CandlePayload, W: number, H: number) {
  const ctx = setupCanvas(canvas, W, H);
  if (!ctx) return;
  const ink = themeInk(canvas);
  const n = Math.min(p.open.length, p.high.length, p.low.length, p.close.length);
  if (n === 0) return;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, p.low[i]); hi = Math.max(hi, p.high[i]); }
  [lo, hi] = span(lo, hi);
  const padL = 30, padR = 4, padT = 4, padB = 13;
  const sy = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  drawYAxis(ctx, ink, lo, hi, sy, padL, W - padR);

  const bw = (W - padL - padR) / n;
  const bodyW = Math.max(1.5, Math.min(9, bw * 0.6));
  for (let i = 0; i < n; i++) {
    const cx = padL + (i + 0.5) * bw;
    const upDay = p.close[i] >= p.open[i];
    const col = upDay ? ink.up : ink.down;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, sy(p.high[i])); ctx.lineTo(cx, sy(p.low[i])); ctx.stroke();
    const yO = sy(p.open[i]), yC = sy(p.close[i]);
    ctx.fillStyle = col;
    ctx.fillRect(cx - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
  }
  // First + last date under the axis (the card is too small for every tick).
  ctx.font = TICK_FONT;
  ctx.fillStyle = ink.dim;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(String(p.labels[0] ?? ""), padL, H - padB + 3);
  ctx.textAlign = "right";
  ctx.fillText(String(p.labels[n - 1] ?? ""), W - padR, H - padB + 3);
}

// ─── Boxplot ───────────────────────────────────────────────────────────────────

function drawBoxplot(canvas: HTMLCanvasElement, p: BoxplotPayload, W: number, H: number) {
  const ctx = setupCanvas(canvas, W, H);
  if (!ctx) return;
  const ink = themeInk(canvas);
  const boxes = p.boxes;
  if (boxes.length === 0) return;
  let lo = Infinity, hi = -Infinity;
  for (const b of boxes) {
    lo = Math.min(lo, b.lo, ...b.outliers);
    hi = Math.max(hi, b.hi, ...b.outliers);
  }
  [lo, hi] = span(lo, hi);
  const padL = 30, padR = 4, padT = 4, padB = 14;
  const sy = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  drawYAxis(ctx, ink, lo, hi, sy, padL, W - padR);

  const bw = (W - padL - padR) / boxes.length;
  const boxW = Math.max(6, Math.min(36, bw * 0.55));
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = padL + (i + 0.5) * bw;
    ctx.strokeStyle = ink.accent;
    ctx.lineWidth = 1;
    for (const [from, to] of [[b.lo, b.q1], [b.q3, b.hi]] as const) {
      ctx.beginPath(); ctx.moveTo(cx, sy(from)); ctx.lineTo(cx, sy(to)); ctx.stroke();
    }
    for (const v of [b.lo, b.hi]) {
      ctx.beginPath(); ctx.moveTo(cx - boxW / 4, sy(v)); ctx.lineTo(cx + boxW / 4, sy(v)); ctx.stroke();
    }
    const yQ1 = sy(b.q1), yQ3 = sy(b.q3);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = ink.accent;
    ctx.fillRect(cx - boxW / 2, yQ3, boxW, Math.max(1, yQ1 - yQ3));
    ctx.globalAlpha = 1;
    ctx.strokeRect(cx - boxW / 2, yQ3, boxW, Math.max(1, yQ1 - yQ3));
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(cx - boxW / 2, sy(b.med)); ctx.lineTo(cx + boxW / 2, sy(b.med)); ctx.stroke();
    ctx.fillStyle = ink.down;
    for (const v of b.outliers) {
      ctx.beginPath(); ctx.arc(cx, sy(v), 1.6, 0, Math.PI * 2); ctx.fill();
    }
    if (b.name && bw >= 20) {
      ctx.font = TICK_FONT;
      ctx.fillStyle = ink.dim;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fitLabel(ctx, b.name, bw - 2), cx, H - padB + 3);
    }
  }
}

// ─── Calendar heatmap ──────────────────────────────────────────────────────────

/** Monday-first weekday index (0 = Mon … 6 = Sun) for a date serial. */
function mondayIndex(serial: number): number {
  return (serialToJsDate(serial).getUTCDay() + 6) % 7;
}

function drawCalHeat(canvas: HTMLCanvasElement, p: CalHeatPayload, W: number, H: number) {
  const ctx = setupCanvas(canvas, W, H);
  if (!ctx) return;
  const ink = themeInk(canvas);
  if (p.days.length === 0) return;
  // The window is capped at a year AND at what the box renders legibly, so a multi-year
  // feed shows its most recent weeks instead of sub-pixel mush.
  const byDay = new Map<number, number>();
  for (let i = 0; i < p.days.length; i++) byDay.set(p.days[i], (byDay.get(p.days[i]) ?? 0) + (p.values[i] ?? 0));
  const dayList = [...byDay.keys()];
  const end = Math.max(...dayList);
  const dataStart = Math.min(...dayList);
  const padL = 14, padT = 11, padR = 1, padB = 1;
  const MIN_CELL = 3.2; // px — below this the grid stops reading as days
  const endMonday = end - mondayIndex(end);
  const spanStart = Math.max(dataStart, end - 365);
  const wantWeeks = (endMonday - (spanStart - mondayIndex(spanStart))) / 7 + 1;
  const maxWeeks = Math.max(4, Math.floor((W - padL - padR) / MIN_CELL));
  const weeks = Math.min(wantWeeks, maxWeeks);
  const gridStart = endMonday - (weeks - 1) * 7; // a Monday, so columns stay week-aligned
  const start = Math.max(spanStart, gridStart);
  const truncated = dataStart < start;

  let vLo = Infinity, vHi = -Infinity;
  for (const [d, v] of byDay) { if (d >= start) { vLo = Math.min(vLo, v); vHi = Math.max(vHi, v); } }
  const norm = (v: number) => (vHi > vLo ? (v - vLo) / (vHi - vLo) : 0.75);

  const cell = Math.min((W - padL - padR) / weeks, (H - padT - padB) / 7);
  const gap = cell > 6 ? 1 : 0.5;

  // Truncation is state the reader must know — the data reaches further back than the grid.
  if (truncated) {
    ctx.font = TICK_FONT;
    ctx.fillStyle = ink.dim;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`last ${weeks} wk`, W - padR - 1, padT - 2);
  }

  // Month labels along the top: at each week whose Monday enters a new month.
  ctx.font = TICK_FONT;
  ctx.fillStyle = ink.dim;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const m = serialToJsDate(gridStart + w * 7).getUTCMonth();
    if (m !== lastMonth) {
      if (w > 0 || weeks < 20) ctx.fillText("JFMAMJJASOND"[m] ?? "", padL + w * cell, padT - 2);
      lastMonth = m;
    }
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const [row, ch] of [[0, "M"], [2, "W"], [4, "F"]] as const) {
    ctx.fillText(ch, padL - 3, padT + (row + 0.5) * cell);
  }

  for (let w = 0; w < weeks; w++) {
    for (let r = 0; r < 7; r++) {
      const day = gridStart + w * 7 + r;
      if (day < start || day > end) continue;
      const x = padL + w * cell, y = padT + r * cell;
      const v = byDay.get(day);
      ctx.fillStyle = ink.sunken;
      ctx.fillRect(x, y, cell - gap, cell - gap);
      if (v != null) {
        ctx.fillStyle = ink.accent;
        ctx.globalAlpha = 0.16 + 0.84 * norm(v);
        ctx.fillRect(x, y, cell - gap, cell - gap);
        ctx.globalAlpha = 1;
      }
    }
  }
}

// ─── Waffle ────────────────────────────────────────────────────────────────────

function drawWaffle(canvas: HTMLCanvasElement, p: WafflePayload, W: number, H: number, colors: string[]) {
  const ctx = setupCanvas(canvas, W, H);
  if (!ctx) return;
  const ink = themeInk(canvas);
  const vals = p.values.filter((v) => Number.isFinite(v) && v > 0);
  if (p.values.length === 0) return;

  // Multiple categories split by share via largest-remainder, so counts always sum to 100.
  let counts: Array<{ n: number; color: string; name: string }> = [];
  const single = p.values.length === 1 && p.values[0] >= 0 && p.values[0] <= 1;
  if (single) {
    counts = [{ n: Math.round(p.values[0] * 100), color: ink.accent, name: p.names[0] ?? "" }];
  } else {
    const total = vals.reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    const raw = p.values.map((v) => (Number.isFinite(v) && v > 0 ? (v / total) * 100 : 0));
    const floors = raw.map(Math.floor);
    let rem = 100 - floors.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f);
    for (const { i } of order) { if (rem <= 0) break; floors[i]++; rem--; }
    counts = floors.map((n, i) => ({ n, color: colors[i % colors.length], name: p.names[i] ?? "" }));
  }

  const legend = !single && counts.some((c) => c.name);
  const legendH = legend ? 12 : 0;
  const side = Math.min(W, H - legendH);
  const cell = side / 10;
  const gap = Math.max(0.75, cell * 0.12);
  const ox = (W - side) / 2, oy = 0;

  let k = 0;
  for (const c of counts) {
    for (let j = 0; j < c.n && k < 100; j++, k++) {
      const col = k % 10, row = 9 - Math.floor(k / 10); // fill bottom-up
      ctx.fillStyle = c.color;
      ctx.fillRect(ox + col * cell, oy + row * cell, cell - gap, cell - gap);
    }
  }
  for (; k < 100; k++) {
    const col = k % 10, row = 9 - Math.floor(k / 10);
    ctx.fillStyle = ink.sunken;
    ctx.fillRect(ox + col * cell, oy + row * cell, cell - gap, cell - gap);
  }
  if (legend) {
    ctx.font = TICK_FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let x = ox;
    const y = side + legendH / 2 + 1;
    for (const c of counts.slice(0, 4)) {
      if (!c.name) continue;
      ctx.fillStyle = c.color;
      ctx.fillRect(x, y - 3, 6, 6);
      ctx.fillStyle = ink.dim;
      const t = fitLabel(ctx, c.name, 52);
      ctx.fillText(t, x + 8, y);
      x += 8 + ctx.measureText(t).width + 8;
      if (x > ox + side - 20) break;
    }
  }
}

// ─── Vector field (quiver) ─────────────────────────────────────────────────────

function drawQuiver(canvas: HTMLCanvasElement, p: QuiverPayload, W: number, H: number) {
  const ctx = setupCanvas(canvas, W, H);
  if (!ctx) return;
  const ink = themeInk(canvas);
  const ny = Math.min(p.u.length, p.v.length);
  const nx = Math.min(p.u[0]?.length ?? 0, p.v[0]?.length ?? 0);
  if (nx === 0 || ny === 0) return;
  const pad = 4;
  const cw = (W - 2 * pad) / nx, ch = (H - 2 * pad) / ny;

  let maxMag = 0;
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const u = p.u[iy]?.[ix], v = p.v[iy]?.[ix];
    if (u == null || v == null) continue;
    maxMag = Math.max(maxMag, Math.hypot(u, v));
  }
  if (maxMag === 0) maxMag = 1;
  const reach = Math.min(cw, ch) * 0.46;

  // +v points UP on screen (plot convention), so canvas-y is negated.
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const cx = pad + (ix + 0.5) * cw, cy = pad + (iy + 0.5) * ch;
    const u = p.u[iy]?.[ix], v = p.v[iy]?.[ix];
    if (u == null || v == null) {
      ctx.fillStyle = ink.border;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(cx, cy, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    const mag = Math.hypot(u, v);
    const t = mag / maxMag;
    const [r, g, b] = heightColor(t);
    const col = `rgb(${r | 0},${g | 0},${b | 0})`;
    const len = reach * (0.15 + 0.85 * t);
    const ang = Math.atan2(-v, u);
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const hx = cx + len * cosA, hy = cy + len * sinA;
    const tx = cx - len * cosA, ty = cy - len * sinA;
    ctx.strokeStyle = col;
    // Thinner shaft on small arrows — a full-width stroke on a 3px arrow reads as a blob.
    ctx.lineWidth = Math.max(0.7, Math.min(cw, ch) * 0.07 * (0.55 + 0.45 * t));
    ctx.lineCap = "round";
    // The shaft stops at the head's base so it can't poke past the tip.
    const hl = Math.min(4.5, len * 0.55);
    if (hl >= 2.2) {
      const bx = hx - hl * cosA, by = hy - hl * sinA; // head base on the shaft
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx, by); ctx.stroke();
      const wh = hl * 0.45; // half-width of the head base
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(bx - wh * sinA, by + wh * cosA);
      ctx.lineTo(bx + wh * sinA, by - wh * cosA);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    }
  }
}

// ─── Contour ───────────────────────────────────────────────────────────────────

function drawContour(canvas: HTMLCanvasElement, p: ContourPayload, W: number, H: number) {
  const ctx = setupCanvas(canvas, W, H);
  if (!ctx) return;
  const ink = themeInk(canvas);
  const { xs, ys, z } = p;
  const nx = xs.length, ny = ys.length;
  const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  if (nx < 2 || ny < 2) return;
  let zmin = Infinity, zmax = -Infinity;
  for (const row of z) for (const v of row) if (fin(v)) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }
  if (!Number.isFinite(zmin)) return;
  if (zmin === zmax) zmax = zmin + 1;

  // Real gutters: drawn over the filled bands the coordinate hints are illegible.
  const padL = 6, padR = 6, padT = 12, padB = 12;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const sx = (v: number) => padL + ((v - xmin) / (xmax - xmin || 1)) * (W - padL - padR);
  const sy = (v: number) => H - padB - ((v - ymin) / (ymax - ymin || 1)) * (H - padT - padB); // y up
  const tz = (v: number) => (v - zmin) / (zmax - zmin);

  // Each cell subdivides into bilinear-shaded subquads; a cell with a missing corner stays
  // blank, a hole like Surface.
  const SUB = 6;
  for (let iy = 0; iy < ny - 1; iy++) for (let ix = 0; ix < nx - 1; ix++) {
    const z00 = z[iy]?.[ix], z10 = z[iy]?.[ix + 1], z01 = z[iy + 1]?.[ix], z11 = z[iy + 1]?.[ix + 1];
    if (!fin(z00) || !fin(z10) || !fin(z01) || !fin(z11)) continue;
    for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
      const u0 = i / SUB, u1 = (i + 1) / SUB, v0 = j / SUB, v1 = (j + 1) / SUB;
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      const zc = z00 * (1 - um) * (1 - vm) + z10 * um * (1 - vm) + z01 * (1 - um) * vm + z11 * um * vm;
      const [r, g, b] = heightColor(tz(zc));
      const xa = sx(xs[ix] + (xs[ix + 1] - xs[ix]) * u0), xb = sx(xs[ix] + (xs[ix + 1] - xs[ix]) * u1);
      const ya = sy(ys[iy] + (ys[iy + 1] - ys[iy]) * v0), yb = sy(ys[iy] + (ys[iy + 1] - ys[iy]) * v1);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      // Overdraw by half a px so the subquads butt together without seams.
      ctx.fillRect(Math.min(xa, xb) - 0.5, Math.min(ya, yb) - 0.5, Math.abs(xb - xa) + 1, Math.abs(yb - ya) + 1);
    }
  }

  // Iso-lines by marching squares, `levels` evenly spaced strictly inside the range.
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 0.8;
  const levels = Math.max(2, p.levels | 0);
  for (let li = 1; li <= levels; li++) {
    const t = zmin + ((zmax - zmin) * li) / (levels + 1);
    for (let iy = 0; iy < ny - 1; iy++) for (let ix = 0; ix < nx - 1; ix++) {
      const z00 = z[iy]?.[ix], z10 = z[iy]?.[ix + 1], z01 = z[iy + 1]?.[ix], z11 = z[iy + 1]?.[ix + 1];
      if (!fin(z00) || !fin(z10) || !fin(z01) || !fin(z11)) continue;
      // Edge crossings (linear interpolation), edges: top (00→10), right (10→11),
      // bottom (01→11), left (00→01) in grid space.
      const pts: Array<[number, number]> = [];
      const cross = (a: number, b: number, ax: number, ay: number, bx: number, by: number) => {
        if ((a - t) * (b - t) < 0) {
          const f = (t - a) / (b - a);
          pts.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
        }
      };
      const X0 = sx(xs[ix]), X1 = sx(xs[ix + 1]), Y0 = sy(ys[iy]), Y1 = sy(ys[iy + 1]);
      cross(z00, z10, X0, Y0, X1, Y0);
      cross(z10, z11, X1, Y0, X1, Y1);
      cross(z01, z11, X0, Y1, X1, Y1);
      cross(z00, z01, X0, Y0, X0, Y1);
      if (pts.length === 2) {
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
      } else if (pts.length === 4) {
        // Saddle: split by the cell-center value.
        const zc = (z00 + z10 + z01 + z11) / 4;
        const pairs = zc > t ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
        for (const [a, b] of pairs) {
          ctx.beginPath(); ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); ctx.stroke();
        }
      }
    }
  }

  // Corner coordinate hints, in the gutters (the card is too small for full axes):
  // x range along the bottom, y max above the top-left.
  ctx.font = TICK_FONT;
  ctx.fillStyle = ink.dim;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText(fmtTick(xmin), padL, H - 1);
  ctx.textAlign = "right";
  ctx.fillText(fmtTick(xmax), W - padR, H - 1);
  ctx.textAlign = "left";
  ctx.fillText(fmtTick(ymax), padL, padT - 2);
}

// ─── React wrappers ────────────────────────────────────────────────────────────
// Theme-subscribed and draw-on-layout; each view checks its own emptiness and falls back to
// the standard em-dash placeholder.

function useThemedCanvas(draw: (canvas: HTMLCanvasElement) => void) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => { if (ref.current) draw(ref.current); });
  return ref;
}

const Empty = () => <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

export function WaterfallView({ payload, width, height }: { payload: WaterfallPayload; width: number; height: number }) {
  const ref = useThemedCanvas((c) => drawWaterfall(c, payload, width, height));
  if (payload.values.length === 0) return <Empty />;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export function CandleView({ payload, width, height }: { payload: CandlePayload; width: number; height: number }) {
  const ref = useThemedCanvas((c) => drawCandle(c, payload, width, height));
  if (payload.close.length === 0) return <Empty />;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export function BoxplotView({ payload, width, height }: { payload: BoxplotPayload; width: number; height: number }) {
  const ref = useThemedCanvas((c) => drawBoxplot(c, payload, width, height));
  if (payload.boxes.length === 0) return <Empty />;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export function CalHeatView({ payload, width, height }: { payload: CalHeatPayload; width: number; height: number }) {
  const ref = useThemedCanvas((c) => drawCalHeat(c, payload, width, height));
  if (payload.days.length === 0) return <Empty />;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export function WaffleView({ payload, width, height, colors }: { payload: WafflePayload; width: number; height: number; colors: string[] }) {
  const ref = useThemedCanvas((c) => drawWaffle(c, payload, width, height, colors));
  if (payload.values.length === 0) return <Empty />;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export function QuiverView({ payload, width, height }: { payload: QuiverPayload; width: number; height: number }) {
  const ref = useThemedCanvas((c) => drawQuiver(c, payload, width, height));
  const ny = Math.min(payload.u.length, payload.v.length);
  const nx = Math.min(payload.u[0]?.length ?? 0, payload.v[0]?.length ?? 0);
  if (nx === 0 || ny === 0) return <Empty />;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export function ContourView({ payload, width, height }: { payload: ContourPayload; width: number; height: number }) {
  const ref = useThemedCanvas((c) => drawContour(c, payload, width, height));
  const empty = payload.xs.length < 2 || payload.ys.length < 2 || !payload.z.some((r) => r.some((v) => v != null && Number.isFinite(v)));
  if (empty) return <Empty />;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

// ─── Seven-segment readout ─────────────────────────────────────────────────────
// Lit segments in the accent over faint ghosts — the LCD idiom that makes this read as a
// display rather than seven floating bars.

// Segment geometry in an 11 × 20.5 digit box: three horizontals (a/g/d), four
// verticals (f/b top, e/c bottom).
const SEGS: Record<string, { x: number; y: number; w: number; h: number }> = {
  a: { x: 2, y: 0, w: 7, h: 2 },
  g: { x: 2, y: 9.25, w: 7, h: 2 },
  d: { x: 2, y: 18.5, w: 7, h: 2 },
  f: { x: 0, y: 2.5, w: 2, h: 6 },
  b: { x: 9, y: 2.5, w: 2, h: 6 },
  e: { x: 0, y: 12, w: 2, h: 6 },
  c: { x: 9, y: 12, w: 2, h: 6 },
};
const LIT: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd",
  "-": "g",
};
const SS_CELL_W = 11, SS_CELL_H = 20.5, SS_GAP = 4.5, SS_DP_W = 4;

type SegCell = { lit: string; dp: boolean };

/** Group a numeric string into digit cells; a '.' becomes the previous cell's
 *  decimal point instead of its own cell. */
function toSegCells(text: string): SegCell[] {
  const cells: SegCell[] = [];
  for (const ch of text) {
    if (ch === ".") {
      if (cells.length) cells[cells.length - 1].dp = true;
      continue;
    }
    cells.push({ lit: LIT[ch] ?? "", dp: false });
  }
  return cells;
}

export function SevenSegView({ text, width, height }: { text: string; width: number; height?: number }) {
  // A blank display (no value) still shows ghost digits, like a meter at rest.
  const cells = toSegCells(text);
  const shown: SegCell[] = cells.length ? cells : Array.from({ length: 4 }, () => ({ lit: "", dp: false }));
  let w = 0;
  const xs = shown.map((c) => { const x = w; w += SS_CELL_W + (c.dp ? SS_DP_W : 0) + SS_GAP; return x; });
  w -= SS_GAP;
  // Scale to fit the given box: cap the rendered digit height, never overflow width.
  const scale = Math.min((height ?? 34) / SS_CELL_H, width / w, 34 / SS_CELL_H);
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", width, height: height ?? Math.ceil(SS_CELL_H * scale) + 8 }}>
      <svg
        width={Math.ceil(w * scale)}
        height={Math.ceil(SS_CELL_H * scale)}
        viewBox={`-0.5 -0.5 ${w + 1} ${SS_CELL_H + 1}`}
        style={{ display: "block" }}
        aria-label={text || undefined}
      >
        {shown.map((cell, i) => (
          <g key={i} transform={`translate(${xs[i]}, 0)`}>
            {Object.entries(SEGS).map(([k, s]) => (
              <rect
                key={k}
                x={s.x} y={s.y} width={s.w} height={s.h} rx={1}
                fill={cell.lit.includes(k) ? "var(--accent)" : "var(--text)"}
                opacity={cell.lit.includes(k) ? 1 : 0.08}
              />
            ))}
            {cell.dp && <circle cx={SS_CELL_W + 2} cy={SS_CELL_H - 1} r={1.3} fill="var(--accent)" />}
          </g>
        ))}
      </svg>
    </div>
  );
}
