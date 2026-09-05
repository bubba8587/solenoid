// The free-drawn cable layer: renders every drawn cable in WORLD coordinates (mounted
// inside RF's <ViewportPortal>, like StandoffLayer) and owns their point editing.
//
// Stacking is the mirror of the standoffs': standoffs sit at z −3, UNDER the graph;
// drawn cables sit above every card, because a drawn arrow's whole job is to point at
// one. They are annotation only — no sockets, no conduits, no ribbons, no part in the
// wired cables' app-wide shape selection.
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import {
  drawnCableStore, drawModeStore,
  DRAWN_DEFAULT_SHAPE, DRAWN_DEFAULT_WIDTH, DRAWN_DEFAULT_COLOR,
  type DrawnCable,
} from "../drawnCables";
import {
  drawnCablePath, drawnArrowHeads, arrowHeadPath, drawnHeadings, hasAngleOverride,
  ARROW_LEN, ARROW_HALF, type DrawnPoint,
} from "../drawnCablePath";
import { appThemeStore } from "../appTheme";
import { themeAccent, resolveColor } from "../palette";
import { unselectAllNodes } from "../canvasCommands";
import { cableSelectionStore } from "../cableState";
import { standoffStore } from "../standoffs";
import { scheduleAutosave } from "../persistence";
import "./drawnCableLayer.css";

// The LINE and its heads are content: they scale with the canvas, exactly like a wired
// cable. The point handles and the hit target are affordances, so they are divided by
// the zoom and stay a constant SCREEN size — otherwise a handle is ungrabbable at 30%
// and a dinner plate at 250%.
const HIT_STROKE = 18;
const HANDLE_R = 5;
const HANDLE_STROKE = 2;
// The needle a point grows once its heading is PINNED by the dial: the override is
// otherwise invisible until you compare the curve to what it would have been.
const NEEDLE_LEN = 15;

/** Squared distance from `p` to segment `a`→`b`. The spans are curved; the chord is
 *  close enough to rank which one a click landed on. */
function distToSpanSq(p: DrawnPoint, a: DrawnPoint, b: DrawnPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len));
  const dx = a.x + vx * t - p.x;
  const dy = a.y + vy * t - p.y;
  return dx * dx + dy * dy;
}

/** Index to insert BEFORE so the new point splits the span nearest `p`. */
function nearestSpanIndex(pts: readonly DrawnPoint[], p: DrawnPoint): number {
  let best = 1;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSpanSq(p, pts[i], pts[i + 1]);
    if (d < bestD) { bestD = d; best = i + 1; }
  }
  return best;
}

/** Drawn-cable selection is exclusive with nodes, cables and standoffs. */
function selectOnly(id: string | null) {
  drawnCableStore.select(id);
  if (id === null) return;
  unselectAllNodes();
  cableSelectionStore.set(null);
  standoffStore.select(null);
}

function ArrowHeads({
  points,
  arrows,
  headScale,
  color,
}: {
  points: readonly DrawnPoint[];
  arrows: DrawnCable["arrows"];
  headScale: number;
  color: string;
}) {
  return (
    <>
      {drawnArrowHeads(points, arrows).map((h, i) => (
        <path
          key={i}
          className="solenoid-drawn-cable__head"
          d={arrowHeadPath(h.tip, h.dirDeg, ARROW_LEN * headScale, ARROW_HALF * headScale)}
          fill={color}
        />
      ))}
    </>
  );
}

function DrawnCableShape({
  cable,
  selected,
  zoom,
  toFlow,
}: {
  cable: DrawnCable;
  selected: boolean;
  zoom: number;
  toFlow: (screen: { x: number; y: number }) => DrawnPoint;
}) {
  const mode = appThemeStore.getMode();
  const color = themeAccent(resolveColor(cable.color), mode);
  const d = drawnCablePath(cable.shape, cable.points);
  const heads = drawnHeadings(cable.points);
  const activePoint = selected ? drawnCableStore.activePoint() : null;
  // Set on pointerdown, read on move: which point is under the finger, and where the
  // grab started, so a body drag translates by the DELTA rather than snapping.
  const drag = useRef<{ index: number | null; last: DrawnPoint; moved: boolean } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, index: number | null) => {
      // The canvas must not pan and RF must not lasso underneath us.
      e.stopPropagation();
      if (e.button !== 0) return;
      // Alt-click a point removes it (refused at two — a cable needs both ends).
      if (index !== null && (e.altKey || e.metaKey)) {
        drawnCableStore.removePoint(cable.id, index);
        scheduleAutosave();
        return;
      }
      selectOnly(cable.id);
      drawnCableStore.setActivePoint(index);
      drag.current = { index, last: toFlow({ x: e.clientX, y: e.clientY }), moved: false };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [cable.id, toFlow],
  );

  // A double-click on the BODY splits the nearest span, so a finished cable can still
  // gain detail. It lives in onClick because a PointerEvent's `detail` is always 0
  // (spec) — the same reason the cable edge detects its double-click here.
  const onBodyClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail < 2) return;
      e.stopPropagation();
      const at = toFlow({ x: e.clientX, y: e.clientY });
      drawnCableStore.insertPoint(cable.id, nearestSpanIndex(cable.points, at), at);
      scheduleAutosave();
    },
    [cable.id, cable.points, toFlow],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      e.stopPropagation();
      const at = toFlow({ x: e.clientX, y: e.clientY });
      if (g.index === null) drawnCableStore.translate(cable.id, at.x - g.last.x, at.y - g.last.y);
      else drawnCableStore.movePoint(cable.id, g.index, at);
      g.last = at;
      g.moved = true;
    },
    [cable.id, toFlow],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = drag.current;
      drag.current = null;
      if (!g) return;
      e.stopPropagation();
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (g.moved) scheduleAutosave();
    },
    [],
  );

  return (
    <g className={`solenoid-drawn-cable${selected ? " solenoid-drawn-cable--selected" : ""}`}>
      <path className="solenoid-drawn-cable__line" d={d} stroke={color} strokeWidth={cable.width} />
      <ArrowHeads points={cable.points} arrows={cable.arrows} headScale={cable.headScale} color={color} />
      <path
        className="solenoid-drawn-cable-hit"
        d={d}
        // Never thinner on screen than the stroke it has to catch.
        strokeWidth={Math.max(HIT_STROKE / zoom, cable.width)}
        onPointerDown={(e) => onPointerDown(e, null)}
        onClick={onBodyClick}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {selected &&
        cable.points.map((p, i) => {
          const pinned = hasAngleOverride(p);
          const cls =
            "solenoid-drawn-cable__handle" +
            (i === activePoint ? " solenoid-drawn-cable__handle--active" : "") +
            (pinned ? " solenoid-drawn-cable__handle--pinned" : "");
          const rad = (heads[i] * Math.PI) / 180;
          return (
            <g key={i}>
              {pinned && (
                <line
                  className="solenoid-drawn-cable__needle"
                  x1={p.x}
                  y1={p.y}
                  x2={p.x + Math.cos(rad) * (NEEDLE_LEN / zoom)}
                  y2={p.y + Math.sin(rad) * (NEEDLE_LEN / zoom)}
                  stroke={color}
                  strokeWidth={HANDLE_STROKE / zoom}
                />
              )}
              <circle
                className={cls}
                cx={p.x}
                cy={p.y}
                r={HANDLE_R / zoom}
                stroke={color}
                strokeWidth={HANDLE_STROKE / zoom}
                style={{ "--handle-ink": color } as React.CSSProperties}
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </g>
          );
        })}
    </g>
  );
}

/** The half-drawn cable following the cursor while the tool is armed. */
function PendingCable({ zoom }: { zoom: number }) {
  // The ONE subscriber to the cursor notifier: this is the only thing that has to
  // repaint at pointer rate.
  useSyncExternalStore(drawModeStore.subscribeCursor, drawModeStore.cursorVersion);
  const pending = drawModeStore.pending();
  const cursor = drawModeStore.cursor();
  if (pending.length === 0) return null;
  const preview = cursor ? [...pending, cursor] : [...pending];
  const mode = appThemeStore.getMode();
  const color = themeAccent(resolveColor(DRAWN_DEFAULT_COLOR), mode);
  return (
    <g className="solenoid-drawn-cable solenoid-drawn-cable--pending">
      {preview.length >= 2 && (
        <path
          className="solenoid-drawn-cable__line"
          d={drawnCablePath(DRAWN_DEFAULT_SHAPE, preview)}
          stroke={color}
          strokeWidth={DRAWN_DEFAULT_WIDTH}
        />
      )}
      {pending.map((p, i) => (
        <circle
          key={i}
          className="solenoid-drawn-cable__handle"
          cx={p.x}
          cy={p.y}
          r={HANDLE_R / zoom}
          stroke={color}
          strokeWidth={HANDLE_STROKE / zoom}
        />
      ))}
    </g>
  );
}

export function DrawnCableLayer() {
  useSyncExternalStore(drawnCableStore.subscribe, drawnCableStore.version);
  // Palette changes notify through the theme store too (appTheme re-notifies).
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  // The armed flag decides whether the svg mounts at all; PendingCable holds its own
  // subscription for the cursor.
  useSyncExternalStore(drawModeStore.subscribe, drawModeStore.version);
  const { screenToFlowPosition } = useReactFlow();
  const zoom = useStore((st) => st.transform[2]);
  const toFlow = useCallback(
    (screen: { x: number; y: number }) => screenToFlowPosition(screen),
    [screenToFlowPosition],
  );

  const all = drawnCableStore.all();
  const selectedId = drawnCableStore.selected();
  if (all.length === 0 && !drawModeStore.armed()) return null;

  return (
    <svg className="solenoid-drawn-cable-svg">
      {all.map((c) => (
        <DrawnCableShape key={c.id} cable={c} selected={c.id === selectedId} zoom={zoom} toFlow={toFlow} />
      ))}
      <PendingCable zoom={zoom} />
    </svg>
  );
}
