import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ClassicPreset } from "rete";
import { Presets } from "rete-react-plugin";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import {
  ConduitNode as ConduitNodeType,
  CONDUIT_MAX_LANES,
  conduitInKey,
  conduitOutKey,
} from "../rete-nodes";
import type { SolenoidConnection, SolenoidNode } from "../schemes";
import { cableAngleStore } from "../cableAngleStore";
import {
  CONDUIT_BODY_SIZE,
  CONDUIT_SQ,
  CONDUIT_COL_GAP,
  CONDUIT_ROW_GAP,
  conduitLayoutStore,
} from "../ribbonCable";
import {
  cableDragStore,
  connectionVersionStore,
  conduitAngleStore,
  bumpConduitAngle,
  getEditor,
  getArea,
  processGraph,
} from "../process";
import { AngleDial } from "../AngleDial";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import "../AngleDial.css";
import "./conduit.css";

const { RefSocket } = Presets.classic;

type Props = {
  data: ConduitNodeType & { width?: number; height?: number };
  emit: RenderEmit<ClassicScheme>;
};

// Fixed hit-area / pivot box. The visible connector grows around the pivot (body
// centre) and overflows this box, so the node's top-left never moves between
// states — no async-translate recenter, no jiggle. (See the "resizable-content
// nodes" note in CLAUDE.md.)
const BODY_SIZE = CONDUIT_BODY_SIZE;
const PIVOT = BODY_SIZE / 2;

// The body IS a 2×N grid of dark-gray squares, and each square IS a socket: the
// left column is the inputs, the right column the outputs, one row per lane.
// Base (full-scale) sizes; deselecting multiplies every dimension by
// COLLAPSED_SCALE — a real layout scale (NOT a CSS transform, which rete's
// offset-based socket measurement would ignore) so cable endpoints track it.
// SQ / gaps live in ribbonCable.ts (shared with the ribbon-trunk geometry).
const COLLAPSED_SCALE = 0.6;
const SQ = CONDUIT_SQ;            // socket square size
const COL_GAP = CONDUIT_COL_GAP;  // gap between the input and output columns
const ROW_GAP = CONDUIT_ROW_GAP;  // gap between lane rows
const SHELL_PAD = 2;     // small housing padding so the squares read as a tight grid
const BORDER_WIDTH = 1.25;
// Red pin-1 stripe, its own row just above the grid (inside the housing).
const STRIPE_H = 3;
const STRIPE_GAP = 2;
const STRIPE_INSET = 1;
// Rotation snaps to 45° increments only: the per-socket cable leads exit along
// the connector angle, and off-45° angles make the diagonal cable shape look bad.
const ANGLE_STEP = 45;

// Wrap an angle into [0, 360). Degrees, CW from +X (SVG screen-space).
const normaliseAngle = (deg: number): number => { const m = deg % 360; return m < 0 ? m + 360 : m; };

// Conduit rotation is quantized to 45°, so the cable leads always exit on a
// diagonal-friendly angle.
const snap45 = (deg: number) => normaliseAngle(Math.round(deg / 45) * 45);

// How many lanes are currently wired (max used in_/out_ index + 1).
function countUsedLanes(nodeId: string): number {
  const editor = getEditor();
  if (!editor) return 0;
  let max = -1;
  for (const c of editor.getConnections()) {
    if (c.target === nodeId && typeof c.targetInput === "string" && c.targetInput.startsWith("in_")) {
      const idx = Number(c.targetInput.slice(3));
      if (Number.isFinite(idx) && idx > max) max = idx;
    }
    if (c.source === nodeId && typeof c.sourceOutput === "string" && c.sourceOutput.startsWith("out_")) {
      const idx = Number(c.sourceOutput.slice(4));
      if (Number.isFinite(idx) && idx > max) max = idx;
    }
  }
  return max + 1;
}

export function ConduitComponent({ data, emit }: Props) {
  const node = data;

  // Angle is DERIVED from node.angle (not held in local state) so a rotate from
  // OUTSIDE this React root — Canvas's `[` / `]` keys — re-renders the block too.
  // Both the dial and the keyboard mutate node.angle then bump conduitAngleStore,
  // which re-renders here; angle re-derives from the node. One source of truth.
  useSyncExternalStore(conduitAngleStore.subscribe, conduitAngleStore.get);
  const angle = snap45(node.angle);
  const setAngle = (v: number) => {
    node.angle = snap45(v);
    bumpConduitAngle();
  };

  // Sequenced ID — commit on Enter/clickaway (project rule). setSeq also
  // renames a derived "Conduit N" label, so recompute to refresh consumers.
  const seqField = useDraftCommit<number>(
    node.seq,
    String,
    (t) => {
      const n = Math.floor(Number(t));
      return Number.isFinite(n) && n >= 1 ? n : INVALID_DRAFT;
    },
    (v) => { node.setSeq(v); void processGraph(); },
  );

  // Re-render on any connection change (lane count). cableDragStore flips while a
  // cable is in flight, gating the expand-on-drag-near behavior.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const dragging = useSyncExternalStore(cableDragStore.subscribe, cableDragStore.get);

  // Proximity gate: only treat a drag as "near" when the pointer is within
  // PROXIMITY_PX of the body box, so the block only expands for cables aimed at
  // THIS conduit.
  const rootRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!dragging) { setNear(false); return; }
    const PROXIMITY_PX = 140;
    function onMove(e: PointerEvent) {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      setNear(Math.hypot(dx, dy) <= PROXIMITY_PX);
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [dragging]);

  const selected = (node as { selected?: boolean }).selected ?? false;
  // The connector is at full scale when selected OR when a cable is dragged near
  // (easy targeting); otherwise it shrinks to COLLAPSED_SCALE.
  const expanded = selected || (dragging && near);

  const realLanes = countUsedLanes(node.id);
  const showPhantom = expanded && dragging && near && realLanes < CONDUIT_MAX_LANES;
  const phantomIdx = showPhantom ? realLanes : -1;
  // At least one lane is always shown so a fresh Conduit has a socket to grab.
  const lanes = Math.max(realLanes + (showPhantom ? 1 : 0), 1);

  // One uniform scale drives the whole connector: full size when expanded,
  // shrunk when compressed. Every dimension below is base × scale.
  const scale = expanded ? 1 : COLLAPSED_SCALE;
  const sq = SQ * scale;
  const halfW = (sq + COL_GAP * scale) / 2; // socket column x offset from centre
  const rowStep = sq + ROW_GAP * scale;
  const socketSize = sq;                     // the square IS the socket

  // Local→world: rotate (lx, ly) by `angle` (CW, screen y-down) around the pivot.
  const rad = (angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const laneY = (i: number) => (i - (lanes - 1) / 2) * rowStep;
  const place = (faceSign: number, i: number) => {
    const lx = faceSign * halfW;
    const ly = laneY(i);
    return { x: lx * c - ly * s, y: lx * s + ly * c };
  };
  const inputHandles  = Array.from({ length: lanes }, (_, i) => place(-1, i));
  const outputHandles = Array.from({ length: lanes }, (_, i) => place(1, i));

  // Housing wraps the square grid tightly (small SHELL_PAD) plus a stripe row at
  // the top. The grid stays centred on the pivot; the housing pokes up a little
  // for the stripe. `rot` spins everything together in pivot-local coords.
  const gridHalfW = halfW + sq / 2;
  const gridHalfH = ((lanes - 1) * rowStep) / 2 + sq / 2;
  const shellPad = SHELL_PAD * scale;
  const stripeH = STRIPE_H * scale;
  const gridTop = PIVOT - gridHalfH;
  const stripeY = gridTop - STRIPE_GAP * scale - stripeH;
  const stripeX = PIVOT - gridHalfW + STRIPE_INSET * scale;
  const stripeW = 2 * gridHalfW - 2 * STRIPE_INSET * scale;
  const rectX = PIVOT - gridHalfW - shellPad;
  const rectW = 2 * (gridHalfW + shellPad);
  const rectY = stripeY - shellPad;
  const rectH = PIVOT + gridHalfH + shellPad - rectY;
  const radius = Math.min(rectW / 2, 5 * scale);
  const rot = `rotate(${angle} ${PIVOT} ${PIVOT})`;

  // Publish live layout for the ribbon-trunk geometry (face centres move when
  // the connector expands/compresses or rotates). `selected` rides along so
  // ribbons touching a selected Conduit separate into individual cables.
  useEffect(() => {
    conduitLayoutStore.set(node.id, { angle, scale, selected });
  }, [node.id, angle, scale, selected]);
  useEffect(() => () => conduitLayoutStore.clear(node.id), [node.id]);

  // Per-socket cable leads. Cables flow along +x (the block's `angle`): inputs
  // arrive heading into the −x face, outputs leave the +x face — both resolve to
  // `angle`. Angle is snapped to 45°, so the diagonal lead always looks clean.
  useEffect(() => {
    const a = snap45(angle);
    for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
      cableAngleStore.set(node.id, conduitInKey(i), a);
      cableAngleStore.set(node.id, conduitOutKey(i), a);
    }
    return () => {
      for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
        cableAngleStore.clear(node.id, conduitInKey(i));
        cableAngleStore.clear(node.id, conduitOutKey(i));
      }
    };
  }, [node.id, angle]);

  // Render the connector BEHIND the cables (z-index:-1 on the node holder, the
  // same trick groups + CableFlourish use), so wires plug in over the square grid.
  useLayoutEffect(() => {
    const el = getArea()?.nodeViews.get(node.id)?.element;
    if (el) el.style.zIndex = "-1";
    return () => { if (el) el.style.zIndex = ""; };
  }, [node.id]);

  // Re-process when the lane count changes so downstream nodes pick up newly
  // routed lanes.
  useEffect(() => { void processGraph(); }, [realLanes]);

  // Extend: spawn a new Conduit downstream (along the flow direction) and wire
  // every current lane's output into it, continuing the ribbon.
  const extendToNewConduit = async () => {
    const editor = getEditor();
    const area = getArea();
    if (!editor || !area) return;
    const next = new ConduitNodeType({ angle: node.angle }) as unknown as SolenoidNode;
    await editor.addNode(next);
    const pos = area.nodeViews.get(node.id)?.position ?? { x: 0, y: 0 };
    await area.translate(next.id, { x: pos.x + 130 * c, y: pos.y + 130 * s });
    const n = Math.max(realLanes, 1);
    for (let i = 0; i < n; i++) {
      try {
        await editor.addConnection(
          new ClassicPreset.Connection(node, conduitOutKey(i), next, conduitInKey(i)) as SolenoidConnection,
        );
      } catch { /* incompatible / duplicate — skip */ }
    }
    await processGraph();
  };

  const renderSocket = (side: "input" | "output", key: string, p: { x: number; y: number }, isPhantom: boolean) => (
    <div
      key={key}
      className={`solenoid-conduit__lane${isPhantom ? " solenoid-conduit__lane--phantom" : ""}`}
      // Rotate the square to align with the housing. This is a visual-only
      // transform around the square's centre — it spins the box without moving
      // its centre, so rete still measures the cable endpoint at p (offsetLeft/Top
      // ignore the transform).
      // COMPRESSED sockets are pointer-transparent: the bunched squares cover
      // the whole pill, so every click would start a cable drag and the block
      // could never be (re)selected. Click-to-select expands it (and a cable
      // dragged near expands it too), which re-enables the sockets exactly
      // when they're big enough to aim at.
      style={{
        left: PIVOT + p.x - socketSize / 2,
        top: PIVOT + p.y - socketSize / 2,
        transform: angle ? `rotate(${angle}deg)` : undefined,
        pointerEvents: expanded ? undefined : "none",
      }}
    >
      <RefSocket
        name={`${side}-socket`}
        side={side}
        socketKey={key}
        nodeId={node.id}
        emit={emit}
        payload={(side === "input" ? node.inputs[key]! : node.outputs[key]!).socket}
      />
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`solenoid-conduit${selected ? " solenoid-conduit--selected" : ""}${expanded ? " solenoid-conduit--expanded" : ""}`}
      style={{ width: BODY_SIZE, height: BODY_SIZE, ["--socket-size" as string]: `${socketSize}px` }}
    >
      <svg className="solenoid-conduit__svg" width={BODY_SIZE} height={BODY_SIZE}>
        <g transform={rot}>
          <rect
            className="solenoid-conduit__block-border"
            x={rectX - BORDER_WIDTH} y={rectY - BORDER_WIDTH}
            width={rectW + 2 * BORDER_WIDTH} height={rectH + 2 * BORDER_WIDTH}
            rx={radius + BORDER_WIDTH}
          />
          <rect
            className="solenoid-conduit__block"
            x={rectX} y={rectY} width={rectW} height={rectH} rx={radius}
          />
          {/* Red pin-1 stripe row at the top, just above the square grid. */}
          <rect
            className="solenoid-conduit__stripe"
            x={stripeX} y={stripeY} width={stripeW} height={stripeH} rx={stripeH / 2}
          />
        </g>
      </svg>

      {inputHandles.map((p, i)  => renderSocket("input",  conduitInKey(i),  p, i === phantomIdx))}
      {outputHandles.map((p, i) => renderSocket("output", conduitOutKey(i), p, i === phantomIdx))}

      {/* Inspector docks to the lower-left of the SCREEN (portal escapes the
          canvas transform, so it's also zoom-invariant) rather than floating
          by the node. */}
      {selected && createPortal(
        <div
          className="solenoid-conduit-toolbar solenoid-conduit-toolbar--docked"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header bar styled like a node-card header (accent border wrapping
              top + sides, uppercase tinted label) — accent derived from the
              Conduit's pin-1 stripe red. Holds the editable sequenced ID. */}
          <div className="solenoid-conduit-toolbar__header" title="Sequenced Conduit number. Drives the default name, Conduit N.">
            <span className="solenoid-conduit-toolbar__header-name">Conduit</span>
            <input
              type="number"
              className="solenoid-conduit-toolbar__seq"
              min={1}
              step={1}
              value={seqField.draft}
              onChange={(e) => seqField.setDraft(e.target.value)}
              onBlur={seqField.onBlur}
              onKeyDown={seqField.onKeyDown}
            />
          </div>
          <button
            type="button"
            className="solenoid-conduit-toolbar__extend"
            onClick={() => void extendToNewConduit()}
            title="Extend the ribbon: add a new Conduit and wire every current lane into it"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5 H8 M2 8 H8 M2 11 H8" />
              <path d="M11 8 H14 M12.5 6 L14.5 8 L12.5 10" />
            </svg>
            Extend
          </button>
          <div className="solenoid-conduit-toolbar__section">Angle</div>
          <div className="solenoid-conduit-toolbar__row">
            <AngleDial value={angle} step={ANGLE_STEP} size={40} onChange={setAngle} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
