import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCablePath, Position } from "../cablePaths";
import { cableShapeStore } from "../cableShape";
import { cableFlourishBridge } from "../cableFlourishStore";

// Purely cosmetic viewport-space overlay (pointer-events:none), unrelated to the
// graph; triggered by the NavMenu button or `window.__cableFlourish()`.

const SVGNS = "http://www.w3.org/2000/svg";

const PALETTE = [
  "#56b4e9", "#e69f00", "#009e73", "#cc79a7",
  "#f0e442", "#d55e00", "#0072b2", "#ec4899",
];

type Pt = { x: number; y: number };
type Run = {
  id: number;
  color: string;
  waypoints: Pt[];     // the route's control points — the track is rebuilt from these
  d: string;           // path data — rendered directly so corners are pixel-perfect
  el: SVGPathElement;  // detached, for getPointAtLength (gradient endpoints + total)
  total: number;
  start: number;
  duration: number;
};

const angleDeg = (from: Pt, to: Pt) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

// The cardinal side a direction most points along — the router's no-angle-hint fallback.
function posFromDir(dx: number, dy: number): Position {
  return Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? Position.Right : Position.Left)
    : (dy >= 0 ? Position.Bottom : Position.Top);
}

// Catmull-Rom tangents become exact exit/entry angles so adjacent legs meet a shared
// waypoint collinearly; each later leg's leading moveto becomes a lineto to fuse them.
function buildPathD(shape: ReturnType<typeof cableShapeStore.get>, wp: Pt[]): string {
  let d = "";
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i];
    const b = wp[i + 1];
    const prev = wp[i - 1] ?? a;
    const next = wp[i + 2] ?? b;
    const exit = angleDeg(prev, b);
    const entry = angleDeg(a, next);
    const seg = getCablePath(shape, {
      sourceX: a.x, sourceY: a.y,
      sourcePosition: posFromDir(Math.cos((exit * Math.PI) / 180), Math.sin((exit * Math.PI) / 180)),
      sourceAngleDeg: exit,
      targetX: b.x, targetY: b.y,
      targetPosition: posFromDir(-Math.cos((entry * Math.PI) / 180), -Math.sin((entry * Math.PI) / 180)),
      targetAngleDeg: entry,
    });
    d += i === 0 ? seg : seg.replace(/^M/, " L");
  }
  return d;
}

function trackElement(waypoints: Pt[], shape: ReturnType<typeof cableShapeStore.get>): { d: string; el: SVGPathElement; total: number } {
  const d = buildPathD(shape, waypoints);
  const el = document.createElementNS(SVGNS, "path");
  el.setAttribute("d", d);
  return { d, el, total: el.getTotalLength() };
}

function makeRun(id: number, w: number, h: number): Run {
  const off = 140;
  const edges: Pt[] = [
    { x: rand(0.1, 0.9) * w, y: -off },
    { x: w + off, y: rand(0.1, 0.9) * h },
    { x: rand(0.1, 0.9) * w, y: h + off },
    { x: -off, y: rand(0.1, 0.9) * h },
  ];
  const startEdge = Math.floor(rand(0, 4));
  let endEdge = Math.floor(rand(0, 4));
  if (endEdge === startEdge) endEdge = (endEdge + 2) % 4;
  const interior: Pt[] = [];
  const interiorCount = Math.floor(rand(1, 3));
  for (let i = 0; i < interiorCount; i++) {
    interior.push({ x: rand(0.15, 0.85) * w, y: rand(0.15, 0.85) * h });
  }
  const waypoints = [edges[startEdge], ...interior, edges[endEdge]];

  const { d, el, total } = trackElement(waypoints, cableShapeStore.get());

  return {
    id,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    waypoints,
    d,
    el,
    total,
    start: performance.now(),
    duration: rand(11000, 16000),
  };
}

export function CableFlourish() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [, setFrame] = useState(0);
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const nextId = useRef(0);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  // Portal into the canvas pane so it paints behind nodes/cables but above the grid.
  useEffect(() => {
    setCanvasEl(document.querySelector<HTMLElement>(".sol-rf-appcanvas .react-flow"));
  }, []);

  const trigger = () => {
    const w = canvasEl?.clientWidth || window.innerWidth;
    const h = canvasEl?.clientHeight || window.innerHeight;
    const run = makeRun(nextId.current++, w, h);
    if (run.total > 0) setRuns((r) => [...r, run]);
  };

  useEffect(() => {
    const unregister = cableFlourishBridge.register(trigger);
    (window as unknown as { __cableFlourish?: () => void }).__cableFlourish = trigger;
    return () => {
      unregister();
      delete (window as unknown as { __cableFlourish?: () => void }).__cableFlourish;
    };
  }, []);

  // Re-route in-flight tracks on a shape change; progress is time-based, so the head
  // resumes at the same fraction of the freshly-routed track.
  useEffect(() => cableShapeStore.subscribe(() => {
    const shape = cableShapeStore.get();
    setRuns((rs) => rs.map((r) => ({ ...r, ...trackElement(r.waypoints, shape) })));
  }), []);

  useEffect(() => {
    if (runs.length === 0) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const live = runsRef.current.filter((r) => now - r.start < r.duration);
      if (live.length !== runsRef.current.length) setRuns(live);
      setFrame((f) => f + 1);
      if (live.length > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runs.length]);

  const now = performance.now();

  const overlay = (
    <svg
      className="solenoid-cable-flourish"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible", zIndex: -1 }}
    >
      <defs>
          {runs.map((run) => {
            const u = clamp01((now - run.start) / run.duration);
            const headLen = u * run.total;
            const trailLen = Math.min(180, run.total * 0.28);
            const fromLen = Math.max(0, headLen - trailLen);
            const head = run.el.getPointAtLength(headLen);
            const tail = run.el.getPointAtLength(fromLen);
            return (
              <linearGradient
                key={run.id}
                id={`flourish-${run.id}`}
                gradientUnits="userSpaceOnUse"
                x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}
              >
                <stop offset="0%" stopColor={run.color} stopOpacity={0} />
                <stop offset="65%" stopColor={run.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={run.color} stopOpacity={0.95} />
              </linearGradient>
            );
          })}
        </defs>
        {runs.map((run) => {
          const u = clamp01((now - run.start) / run.duration);
          const headLen = u * run.total;
          const trailLen = Math.min(180, run.total * 0.28);
          const fromLen = Math.max(0, headLen - trailLen);
          const head = run.el.getPointAtLength(headLen);
          const envelope = Math.sin(u * Math.PI);
          return (
            <g key={run.id} style={{ opacity: envelope }}>
              {/* Dash clipping on the real path, so corners stay exact. */}
              <path
                d={run.d}
                fill="none"
                stroke={`url(#flourish-${run.id})`}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeDasharray={`${trailLen} ${run.total + trailLen}`}
                strokeDashoffset={-fromLen}
              />
              <circle cx={head.x} cy={head.y} r={3} fill={run.color} />
            </g>
          );
        })}
    </svg>
  );

  return canvasEl ? createPortal(overlay, canvasEl) : null;
}
