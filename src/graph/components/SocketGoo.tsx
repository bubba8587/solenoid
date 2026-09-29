// [[B14]] oneDesignSystem (DESIGN.md § Card sections, the fold's liquid merge)
import { useId, useLayoutEffect, useRef } from "react";
import { socketRingColor } from "./SocketComponent";
import { cableEndMotion } from "../cableEndMotion";

/** The flow y of a point `dy` screen-unscaled px below the top of `el`, a node on the React Flow canvas: through the
 *  viewport's own transform, so a card nested in a group's sub-flow lands right too (the viewport box's top-left is
 *  the flow origin on screen). Undefined off the canvas. */
export function flowYOf(el: Element, dy: number): number | undefined {
  const viewport = el.closest<HTMLElement>(".react-flow__viewport");
  if (!viewport) return undefined;
  const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
  return (el.getBoundingClientRect().top - viewport.getBoundingClientRect().top) / zoom + dy;
}

/** One socket dot in the goo: its socket-top (the NodeSocket wrapper's top, content coordinates) and its fill. */
export type GooDrop = { key: string; top: number; color: string };

const R = 6; // a socket dot's radius
const PILL_H = 28;
const PAD = 24; // room for the blur and the wobble past the drops' extent
const MERGE_MS = 560;
const SPLIT_MS = 620;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInCubic = (t: number) => t * t * t;
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
// A damped wobble for jelly settling: 0 at t=0 and t=1, a few decaying swings between.
const wobble = (t: number) => Math.sin(t * Math.PI * 3.5) * (1 - t) ** 2;

/** The liquid fold: socket dots run together into a pill (merge) or bud off it back to their rows (split).
 *  Drawn over the socket column through a gooey filter (a blur, then an alpha threshold), so shapes that near fuse
 *  with a neck that stretches and snaps; each shape's ring-colored twin sits under it, 2px bigger, as its border. Every frame writes attributes on refs; React renders it once. */
export function SocketGoo({ nodeId, mode, drops, pillTop, pillColor, pillHeight = PILL_H, onDone }: {
  /** The card: its drops' cables ride along (cableEndMotion). */
  nodeId: string;
  mode: "merge" | "split";
  drops: GooDrop[];
  /** The caption's socket top: where the pill sits. */
  pillTop: number;
  pillColor: string;
  /** What the drops become: the pill's 28, or one dot's 12 for a lone socket. */
  pillHeight?: number;
  onDone: () => void;
}) {
  const filterId = `sol-goo-${useId().replace(/:/g, "")}`;
  // Two layers share every shape: [0] in ring colors, [1] in fill colors shrunk by the ring's width.
  const dropRefs = useRef<(SVGEllipseElement | null)[][]>([[], []]);
  const pillRefs = useRef<(SVGRectElement | null)[]>([null, null]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const pillCy = pillTop + R;
  const ys = [pillCy - pillHeight / 2, pillCy + pillHeight / 2, ...drops.map((d) => d.top + R)];
  const y0 = Math.min(...ys) - PAD;
  const height = Math.max(...ys) + PAD - y0;
  const cx = PAD;

  useLayoutEffect(() => {
    const total = mode === "merge" ? MERGE_MS : SPLIT_MS;
    const n = drops.length;
    const stagger = n > 1 ? 0.12 / (n - 1) : 0;
    const start = performance.now();
    let raf = 0;
    // Each drop's cable end follows the drop.
    const carryCables = (ends: [string, number][]) => {
      const svg = svgRef.current;
      const svgTop = svg ? flowYOf(svg, 0) : undefined;
      if (svgTop === undefined) return;
      cableEndMotion.setYs(nodeId, ends.map(([k, y]) => [k, svgTop + y] as const));
    };
    const setPill = (h: number, w: number) => {
      for (const el of pillRefs.current) {
        if (!el) continue;
        el.setAttribute("x", String(cx - w / 2));
        el.setAttribute("y", String(pillCy - y0 - h / 2));
        el.setAttribute("width", String(w));
        el.setAttribute("height", String(Math.max(0, h)));
        el.setAttribute("rx", String(Math.min(w, h) / 2));
      }
    };
    const frame = () => {
      const t = clamp01((performance.now() - start) / total);
      let absorbed = 0;
      const ends: [string, number][] = [];
      drops.forEach((d, i) => {
        const layers = dropRefs.current.map((l) => l[i]).filter((e): e is SVGEllipseElement => !!e);
        if (layers.length === 0) return;
        const set = (k: string, v: string) => layers.forEach((e) => e.setAttribute(k, v));
        const rowCy = d.top + R;
        if (mode === "merge") {
          // Each drop falls up into the caption, accelerating, stretched along its path by its speed.
          const local = clamp01((t - i * stagger) / 0.62);
          const p = easeInCubic(local);
          const speed = 3 * local * local; // d/dt of t³
          const cy = rowCy + (pillCy - rowCy) * p;
          const stretch = Math.min(0.9, speed * 0.35);
          const shrink = local >= 1 ? 0 : 1 - 0.25 * p;
          set("cy", String(cy - y0));
          ends.push([d.key, cy - y0]);
          set("rx", String(R * shrink / (1 + stretch * 0.5)));
          set("ry", String(R * shrink * (1 + stretch)));
          absorbed += p;
        } else {
          // Each drop buds off the pill and springs to its row, overshooting and stretched while it moves fast.
          const local = clamp01((t - i * stagger) / 0.78);
          const p = easeOutBack(local);
          const cy = pillCy + (rowCy - pillCy) * p;
          const speed = Math.abs(easeOutBack(clamp01(local + 0.02)) - p) * 50;
          const stretch = Math.min(0.8, speed * 0.3);
          const grow = 0.55 + 0.45 * clamp01(local * 1.6);
          set("cy", String(cy - y0));
          ends.push([d.key, cy - y0]);
          set("rx", String(R * grow / (1 + stretch * 0.5)));
          set("ry", String(R * grow * (1 + stretch)));
          absorbed += 1 - clamp01(local * 1.4);
        }
      });
      const share = n > 0 ? absorbed / n : 1;
      if (mode === "merge") {
        // The pill swells as the drops arrive, then wobbles like jelly as it settles.
        const settle = clamp01((t - 0.62) / 0.38);
        const h = (R * 2 + (pillHeight - R * 2) * share) * (share > 0.05 ? 1 : share * 20) * (1 + 0.18 * wobble(settle));
        const w = R * 2 * (1 - 0.12 * wobble(settle));
        setPill(h, w);
      } else {
        // The pill gives up its liquid: it bulges as the drops pull, then drains to nothing.
        const h = pillHeight * share * (1 + 0.15 * Math.sin(clamp01(t / 0.35) * Math.PI));
        setPill(h, R * 2 * (0.7 + 0.3 * share));
      }
      carryCables(ends);
      if (t < 1) raf = requestAnimationFrame(frame);
      else done.current();
    };
    // The first frame draws now, before paint, so the cables never show a frame at their sockets' stale spots.
    frame();
    return () => { cancelAnimationFrame(raf); cableEndMotion.clear(nodeId, drops.map((d) => d.key)); };
    // One run per mount; the fold remounts it for the next.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg
      ref={svgRef}
      className="solenoid-node__socket-goo"
      aria-hidden
      width={PAD * 2}
      height={height}
      style={{ top: y0, left: `calc(var(--node-socket-x, -5px) + ${R}px - ${PAD}px)` }}
    >
      <defs>
        {/* Liquid: a blur, then an alpha threshold, so shapes that near fuse with a neck. */}
        <filter id={filterId} x="-50%" y="-20%" width="200%" height="140%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
        </filter>
        {/* The same field cut at a higher level: an even 2px inset (the socket ring's width), necks included, laid over
            the ring-colored layer so the ring shows as its border. 0.64 is the blurred dot's level 2px in from the 0.43 edge. */}
        <filter id={`${filterId}-in`} x="-50%" y="-20%" width="200%" height="140%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -13.6" />
        </filter>
      </defs>
      {[0, 1].map((layer) => (
        <g key={layer} filter={`url(#${filterId}${layer === 1 ? "-in" : ""})`}>
          <rect
            ref={(el) => { pillRefs.current[layer] = el; }}
            fill={layer === 0 ? socketRingColor(pillColor) : pillColor}
            x={cx} y={pillCy - y0} width={0} height={0}
          />
          {drops.map((d, i) => (
            <ellipse
              key={i}
              ref={(el) => { dropRefs.current[layer][i] = el; }}
              fill={layer === 0 ? socketRingColor(d.color) : d.color}
              cx={cx}
              cy={(mode === "merge" ? d.top + R : pillCy) - y0}
              rx={mode === "merge" ? R : 0}
              ry={mode === "merge" ? R : 0}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
