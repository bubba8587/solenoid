// World-space layer for drawn cables (inside RF's <ViewportPortal>, the standoffs'
// mirror, but ABOVE the cards). Spec: docs/subsystem-invariants.md § Drawn cables.
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import {
  drawnCableStore, drawModeStore, commitDrawn,
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
import { IS_COARSE } from "../coarse";
import { isPinching } from "../pointerGesture";
import "./drawnCableLayer.css";

// Affordance sizes are SCREEN pixels (divided by the zoom at render); the line and
// heads are canvas units.
const HIT_STROKE = IS_COARSE ? 40 : 18;
const HANDLE_R = IS_COARSE ? 11 : 5;
const PENDING_R = 5;
const HANDLE_STROKE = IS_COARSE ? 2.5 : 2;
const HANDLE_HIT_R = IS_COARSE ? 22 : 9;
const NEEDLE_LEN = 15;

/** Squared distance from `p` to the chord `a`→`b`. */
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
  const d = drawnCablePath(cable.shape, cable.points, cable.arrows, ARROW_LEN * cable.headScale);
  const dHit = drawnCablePath(cable.shape, cable.points);
  const heads = drawnHeadings(cable.points);
  const activePoint = selected ? drawnCableStore.activePoint() : null;
  // On touch an UNSELECTED body is pan surface: the tap's click selects, a drag pans
  // (touch-gestures.md). Grabbable things carry `nopan` so RF's d3 pan stands down.
  const bodyGrabs = !IS_COARSE || selected;
  const drag = useRef<{ index: number | null; last: DrawnPoint; moved: boolean } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, index: number | null) => {
      if (e.button !== 0) return;
      if (index === null && !bodyGrabs) return;
      e.stopPropagation();
      if (index !== null && e.altKey) {
        drawnCableStore.removePoint(cable.id, index);
        commitDrawn();
        return;
      }
      selectOnly(cable.id);
      drawnCableStore.setActivePoint(index);
      drag.current = { index, last: toFlow({ x: e.clientX, y: e.clientY }), moved: false };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [cable.id, toFlow, bodyGrabs],
  );

  // Double-click is only legible here: a PointerEvent's `detail` is always 0.
  const onBodyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.detail >= 2 && !IS_COARSE) {
        const at = toFlow({ x: e.clientX, y: e.clientY });
        drawnCableStore.insertPoint(cable.id, nearestSpanIndex(cable.points, at), at);
        commitDrawn();
        return;
      }
      if (!selected) selectOnly(cable.id);
    },
    [cable.id, cable.points, toFlow, selected],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      if (isPinching()) { drag.current = null; return; }
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
      if (g.moved) commitDrawn();
    },
    [],
  );

  return (
    <g
      className={`solenoid-drawn-cable${selected ? " solenoid-drawn-cable--selected" : ""}`}
      style={{ color }}
    >
      <path className="solenoid-drawn-cable__line" d={d} stroke={color} strokeWidth={cable.width} />
      <ArrowHeads points={cable.points} arrows={cable.arrows} headScale={cable.headScale} color={color} />
      <path
        className={`solenoid-drawn-cable-hit${bodyGrabs ? " nopan" : ""}`}
        d={dHit}
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
            "solenoid-drawn-cable__handle nopan" +
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
                className="solenoid-drawn-cable__handle-hit nopan"
                cx={p.x}
                cy={p.y}
                r={HANDLE_HIT_R / zoom}
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
              {/* Color via a custom property: a CSS `fill` rule outranks a fill attribute. */}
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

/** The half-drawn run following the cursor while the tool is armed. */
function PendingCable({ zoom }: { zoom: number }) {
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
          r={PENDING_R / zoom}
          stroke={color}
          strokeWidth={2 / zoom}
        />
      ))}
    </g>
  );
}

export function DrawnCableLayer() {
  useSyncExternalStore(drawnCableStore.subscribe, drawnCableStore.version);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
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
