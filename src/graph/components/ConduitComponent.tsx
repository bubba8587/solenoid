// [[C65]] domOrderStacking. Mechanics: tree/specs/canvas/resizable-content-nodes.md, tree/specs/canvas/conduit-lane-faces.md.
import { SocketComponent } from "./SocketComponent";
import type { Emit } from "./nodeKit";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ClassicPreset } from "rete";
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
  conduitLaneOffset,
  conduitLayoutStore,
} from "../ribbonCable";
import { processGraph, isGraphRebuilding, notifyGraphChanged } from "../process";
import { cableDragStore, connectionVersionStore, conduitAngleStore, bumpConduitAngle } from "../graphSignals";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { useFlowSocket } from "../flowSurface";
import { AngleDial } from "../AngleDial";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import "../AngleDial.css";
import "./conduit.css";

type Props = {
  data: ConduitNodeType & { width?: number; height?: number };
  emit?: Emit;
};

const BODY_SIZE = CONDUIT_BODY_SIZE;
const PIVOT = BODY_SIZE / 2;

// A real layout scale, not a CSS transform: socket measurement ignores transforms, so cable endpoints would stop tracking.
const COLLAPSED_SCALE = 0.6;
const SQ = CONDUIT_SQ;
const COL_GAP = CONDUIT_COL_GAP;
const ROW_GAP = CONDUIT_ROW_GAP;
const SHELL_PAD = 2;
const BORDER_WIDTH = 1.25;
const HANDLE_H = 12;
const HANDLE_GAP = 1;
const STRIPE_H = 3;
const STRIPE_INSET = 2.5;
const ANGLE_STEP = 45;

const normaliseAngle = (deg: number): number => { const m = deg % 360; return m < 0 ? m + 360 : m; };

const snap45 = (deg: number) => normaliseAngle(Math.round(deg / 45) * 45);

function topBand(x: number, y: number, w: number, h: number, r: number): string {
  const c = Math.max(0, Math.min(r, w / 2, h));
  return `M ${x} ${y + c} A ${c} ${c} 0 0 1 ${x + c} ${y} H ${x + w - c} A ${c} ${c} 0 0 1 ${x + w} ${y + c} V ${y + h} H ${x} Z`;
}

function countUsedLanes(nodeId: string): number {
  // A Conduit inside a drill-in counts its own graph's cables.
  const editor = getOwningEditor(nodeId);
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

export function ConduitComponent({ data }: Props) {
  const node = data;
  const FlowSocket = useFlowSocket();

  // Derived from node.angle, never local state, so a rotate from outside this root (the `[` and `]` keys) re-renders the block.
  useSyncExternalStore(conduitAngleStore.subscribe, conduitAngleStore.get);
  const angle = snap45(node.angle);
  const setAngle = (v: number) => {
    node.angle = snap45(v);
    bumpConduitAngle();
    notifyGraphChanged();
  };

  // setSeq also renames a derived "Conduit N" label, so recompute to refresh consumers.
  const seqField = useDraftCommit<number>(
    node.seq,
    String,
    (t) => {
      const n = Math.floor(Number(t));
      return Number.isFinite(n) && n >= 1 ? n : INVALID_DRAFT;
    },
    (v) => { node.setSeq(v); void processGraph(); },
  );

  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const dragging = useSyncExternalStore(cableDragStore.subscribe, cableDragStore.get);

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
  const expanded = selected || (dragging && near);

  const realLanes = countUsedLanes(node.id);
  const showPhantom = expanded && dragging && near && realLanes < CONDUIT_MAX_LANES;
  const phantomIdx = showPhantom ? realLanes : -1;
  const lanes = Math.max(realLanes + (showPhantom ? 1 : 0), 1);

  const scale = expanded ? 1 : COLLAPSED_SCALE;
  const sq = SQ * scale;
  const halfW = (sq + COL_GAP * scale) / 2;
  const rowStep = sq + ROW_GAP * scale;
  const socketSize = sq;

  const rad = (angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Squares and cable tips (ribbonCable.conduitLanePoint) read the same lane geometry, so a tip can't drift off its square.
  const place = (side: "in" | "out", i: number) => conduitLaneOffset({ angle, scale, lanes }, side, i);
  const inputHandles  = Array.from({ length: lanes }, (_, i) => place("in", i));
  const outputHandles = Array.from({ length: lanes }, (_, i) => place("out", i));

  const gridHalfW = halfW + sq / 2;
  const gridHalfH = ((lanes - 1) * rowStep) / 2 + sq / 2;
  const shellPad = SHELL_PAD * scale;
  const gridTop = PIVOT - gridHalfH;
  const rectX = PIVOT - gridHalfW - shellPad;
  const rectW = 2 * (gridHalfW + shellPad);
  const rectY = gridTop - HANDLE_GAP * scale - HANDLE_H;
  const rectH = PIVOT + gridHalfH + shellPad - rectY;
  const radius = Math.min(rectW / 2, 6 * scale);
  const handleH = HANDLE_H;
  const stripeH = STRIPE_H;
  const stripeY = rectY + (handleH - stripeH) / 2;
  const stripeX = rectX + STRIPE_INSET;
  const stripeW = rectW - 2 * STRIPE_INSET;
  const rot = `rotate(${angle} ${PIVOT} ${PIVOT})`;

  // Cable endpoints and ribbon trunks derive from this, so `lanes` and `scale` must ride along or endpoints stall on the old shape.
  useEffect(() => {
    conduitLayoutStore.set(node.id, { angle, scale, selected, lanes });
  }, [node.id, angle, scale, selected, lanes]);
  useEffect(() => () => conduitLayoutStore.clear(node.id), [node.id]);

  // React Flow re-measures socket boxes only on a version bump; without it the lane squares stay drop targets at their collapsed spots.
  useEffect(() => {
    void getOwningView(node.id)?.rerenderNode(node.id);
  }, [node.id, angle, scale, lanes]);

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

  useLayoutEffect(() => {
    const el = getOwningView(node.id)?.nodeElement(node.id);
    if (el) el.style.zIndex = "-1";
    return () => { if (el) el.style.zIndex = ""; };
  }, [node.id]);

  // Not during a load: this mount effect fires mid-addNode, before the graph is built, and the rebuild's own final pass recomputes anyway.
  useEffect(() => { if (isGraphRebuilding()) return; void processGraph(); }, [realLanes]);

  const extendToNewConduit = async () => {
    const editor = getOwningEditor(node.id);
    const view = getOwningView(node.id);
    if (!editor || !view) return;
    const next = new ConduitNodeType({ angle: node.angle }) as unknown as SolenoidNode;
    await editor.addNode(next);
    const pos = view.position(node.id) ?? { x: 0, y: 0 };
    await view.moveNode(next.id, { x: pos.x + 130 * c, y: pos.y + 130 * s });
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
      className={
        "solenoid-conduit__lane"
        + (isPhantom ? " solenoid-conduit__lane--phantom" : "")
        + (expanded ? "" : " solenoid-conduit__lane--inert")
      }
      style={{
        left: PIVOT + p.x - socketSize / 2,
        top: PIVOT + p.y - socketSize / 2,
        transform: angle ? `rotate(${angle}deg)` : undefined,
      }}
    >
      {(() => {
        // In the RF tree lane dots must be RF Handles (injected by flowSurface.ts), or edges into the lanes have no endpoints.
        const payload = (side === "input" ? node.inputs[key]! : node.outputs[key]!).socket;
        return FlowSocket ? (
          <FlowSocket side={side} socketKey={key} payload={payload} shape="square" lit={false} />
        ) : (
          <SocketComponent data={payload}
          />
        );
      })()}
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
          <path
            className="solenoid-conduit__handle"
            d={topBand(rectX, rectY, rectW, handleH, radius)}
          />
          <rect
            className="solenoid-conduit__stripe"
            x={stripeX} y={stripeY} width={stripeW} height={stripeH} rx={stripeH / 2}
          />
        </g>
      </svg>

      {inputHandles.map((p, i)  => renderSocket("input",  conduitInKey(i),  p, i === phantomIdx))}
      {outputHandles.map((p, i) => renderSocket("output", conduitOutKey(i), p, i === phantomIdx))}

      {selected && createPortal(
        <div
          className="solenoid-conduit-toolbar solenoid-conduit-toolbar--docked"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
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
            title="Extend the ribbon: add a new Conduit and connect every current lane to it"
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
