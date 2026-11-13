// The Probability pack's picture strip (tree/specs/computation/probability-pack.md § The pictures): a distribution
// drawn from the points its body shows, the answer's range in the card's accent.
import type { CSSProperties, ReactNode, Ref } from "react";

export const PLOT_W = 196;
export const PLOT_H = 92;
const TOP = 15;

export const ACCENT = "var(--node-accent, var(--accent))";
export const WASH = "color-mix(in srgb, var(--node-accent, var(--accent)) 22%, transparent)";
export const MUTED = "var(--text-muted)";
export const MUTED_WASH = "color-mix(in srgb, var(--text-muted) 14%, transparent)";

export const stripStyle: CSSProperties = {
  position: "relative",
  width: PLOT_W,
  height: PLOT_H,
  margin: "2px auto 4px",
  borderRadius: 8,
  background: "var(--surface-sunken)",
  border: "1px solid var(--border-strong)",
  overflow: "hidden",
};

export type Pts = ReadonlyArray<number | null> | null | undefined;

/** The finite points of a shown curve, as [x, y] pairs. */
export function pairs(xs: Pts, ys: Pts): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!xs || !ys) return out;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

export interface Scale { x0: number; x1: number; yMax: number }

export function scaleOf(series: ReadonlyArray<ReadonlyArray<[number, number]>>, pad = 0): Scale | null {
  let x0 = Infinity, x1 = -Infinity, yMax = 0;
  for (const s of series) for (const [x, y] of s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); yMax = Math.max(yMax, y); }
  if (!(x1 >= x0) || !(yMax > 0)) return null;
  if (x1 === x0) { x0 -= 0.5; x1 += 0.5; }
  return { x0: x0 - pad, x1: x1 + pad, yMax };
}

export const px = (s: Scale, x: number) => ((x - s.x0) / (s.x1 - s.x0)) * PLOT_W;
export const py = (s: Scale, y: number) => PLOT_H - (y / s.yMax) * (PLOT_H - TOP);
export const valueAt = (s: Scale, fx: number) => s.x0 + fx * (s.x1 - s.x0);

/** The area under a curve, from `from` to `to` in data x (the whole curve by default). */
export function areaPath(s: Scale, pts: ReadonlyArray<[number, number]>, from = -Infinity, to = Infinity): string {
  const inside = pts.filter(([x]) => x >= from && x <= to);
  if (pts.length < 2) return "";
  // The cut edges sit on the curve itself, read by straight-line interpolation between its points.
  const at = (x: number): number => {
    for (let i = 1; i < pts.length; i++) {
      const [xa, ya] = pts[i - 1], [xb, yb] = pts[i];
      if (x >= xa && x <= xb) return xb === xa ? ya : ya + ((yb - ya) * (x - xa)) / (xb - xa);
    }
    return 0;
  };
  const lo = Math.max(from, pts[0][0]), hi = Math.min(to, pts[pts.length - 1][0]);
  if (!(hi > lo)) return "";
  const edge: Array<[number, number]> = [[lo, at(lo)], ...inside.filter(([x]) => x > lo && x < hi), [hi, at(hi)]];
  const top = edge.map(([x, y], i) => `${i ? "L" : "M"}${px(s, x).toFixed(1)},${py(s, y).toFixed(1)}`).join(" ");
  return `${top} L${px(s, hi).toFixed(1)},${PLOT_H} L${px(s, lo).toFixed(1)},${PLOT_H} Z`;
}

export function linePath(s: Scale, pts: ReadonlyArray<[number, number]>): string {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${px(s, x).toFixed(1)},${py(s, y).toFixed(1)}`).join(" ");
}

/** Columns centered on each point, `inRange` deciding which take the accent. */
export function Bars({ s, pts, inRange }: { s: Scale; pts: ReadonlyArray<[number, number]>; inRange: (x: number) => boolean }) {
  const step = pts.length > 1 ? (PLOT_W * (pts[1][0] - pts[0][0])) / (s.x1 - s.x0) : PLOT_W / 2;
  const w = Math.max(1, step * 0.78);
  return (
    <>
      {pts.map(([x, y]) => {
        const top = py(s, y);
        return (
          <rect key={x} x={px(s, x) - w / 2} y={top} width={w} height={PLOT_H - top}
            fill={inRange(x) ? ACCENT : "var(--border-strong)"} />
        );
      })}
    </>
  );
}

/** A one-letter name over a curve's peak, as HTML positioned like Curve's points. */
export function PeakTag({ x, y, color, children }: { x: number; y: number; color: string; children: ReactNode }) {
  return (
    <span style={{
      position: "absolute", left: x, top: Math.max(0, y - 14), transform: "translateX(-50%)",
      fontSize: 10, fontWeight: 600, lineHeight: "12px", color, pointerEvents: "none",
    }}>
      {children}
    </span>
  );
}

export function Strip({ children, overlay, divRef, style, ...rest }: {
  children: ReactNode;
  overlay?: ReactNode;
  divRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div ref={divRef} style={{ ...stripStyle, ...style }} {...rest}>
      <svg width={PLOT_W} height={PLOT_H} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
        {children}
      </svg>
      {overlay}
    </div>
  );
}
