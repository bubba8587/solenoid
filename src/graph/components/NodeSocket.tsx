// [[C11]] socketBox12
import type { Emit } from "./nodeKit";
import { useSyncExternalStore, useRef, useState, useLayoutEffect, useEffect, type ReactNode } from "react";
import type { ClassicPreset } from "rete";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { socketFlipStore } from "../socketFlipStore";
import { useFlowSocket } from "../flowSurface";
import { SolenoidSocket, SOCKET_TYPE_LABELS } from "../sockets";
import { frameHintFor, frameHintStore, type FrameHint } from "../frameHint";
import { isChipSummaryPeek } from "../valuePeekKind";
import { cableValueStore } from "../cableValueStore";
import { getActiveEditor } from "../activeGraph";
import { cubeTransform, CUBE_FILL_PATH } from "./cubeGlyph";
import { SocketComponent, LIST_TYPES, TABLE_TYPES, COMBO_COLORS } from "./SocketComponent";

// Hover intent, so a cable drag crossing sockets never flashes hints.
const HINT_DELAY_MS = 300;
const PEEK_DELAY_MS = 400;

function hintFor(side: Side, nodeId: string, socketKey: string): FrameHint | undefined {
  if (side !== "input") return undefined;
  const node = getActiveEditor()?.getNode(nodeId);
  return node ? frameHintFor(node, socketKey) : undefined;
}

// Derived from the sets SocketComponent draws from, so a square glyph never gets a round halo or hit area.
const SQUARE_TYPES = new Set<string>([
  ...LIST_TYPES, ...TABLE_TYPES, ...Object.keys(COMBO_COLORS), "frame", "chart", "document",
]);


type Side = "input" | "output";

type Props = {
  side: Side;
  socketKey: string;
  nodeId: string;
  emit?: Emit;
  payload: ClassicPreset.Socket;
  top?: number;
  className?: string;
};

function useRowSocketTop(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const prev = useRef<number | undefined>(undefined);
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t = el.offsetTop + el.offsetHeight / 2 - 6;
    if (prev.current !== t) { prev.current = t; setTop(t); }
  });
  return top;
}

export function MeasuredSocketRow({
  side, socketKey, nodeId, emit, payload, children, hero = false,
}: {
  side: Side;
  socketKey: string;
  nodeId: string;
  emit?: Emit;
  payload: ClassicPreset.Socket;
  children: ReactNode;
  /** A tall box: drops the fixed 22px row height so it can't overlap its neighbors. */
  hero?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowSocketTop(ref);
  const rowHintTap = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("input, select, textarea, button, [contenteditable='true']")) return;
    const hint = hintFor(side, nodeId, socketKey);
    if (!hint) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    frameHintStore.open({ kind: "example", hint, anchor: { left: r.left, right: r.right, centerY: r.top + r.height / 2 } });
  };
  return (
    <div ref={ref} onPointerUp={rowHintTap} className={"solenoid-node__io-row" + (side === "output" ? " solenoid-node__io-row--output" : "") + (hero ? " solenoid-node__io-row--hero" : "")}>
      {top !== undefined && (
        <NodeSocket
          side={side}
          socketKey={socketKey}
          nodeId={nodeId}
          emit={emit}
          payload={payload}
          top={top}
        />
      )}
      {children}
    </div>
  );
}

export function SocketLitRing({ shape }: { shape: "circle" | "square" | "cube" }) {
  return (
    <svg
      aria-hidden="true"
      className="solenoid-socket-lit"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "var(--socket-size, 12px)",
        height: "var(--socket-size, 12px)",
        pointerEvents: "none",
        overflow: "visible",
      }}
      viewBox="0 0 12 12"
    >
      {shape === "cube"
        ? (
          // Group opacity, never per element, or the fill and stroke overlap doubles into a dark rim.
          <g transform={cubeTransform(1)} opacity="0.35" style={{ mixBlendMode: "overlay" }}>
            <path d={CUBE_FILL_PATH} fill="white" stroke="white" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        )
        : shape === "square"
        ? <rect x="0" y="0" width="12" height="12" rx="1.5" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
        : <circle cx="6" cy="6" r="6" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
      }
    </svg>
  );
}

export function NodeSocket({ side, socketKey, nodeId, payload, top, className }: Props) {
  const FlowSocket = useFlowSocket();
  // `data-socket-side` stays the semantic side; only the visual edge moves (DOM lookups resolve by the measured dot).
  const flipped = useSyncExternalStore(socketFlipStore.subscribe, () => socketFlipStore.get(nodeId));
  const visualSide: Side = flipped ? (side === "input" ? "output" : "input") : side;
  // -5 for card- and group-anchored sockets; .solenoid-node__content overrides the var (nodeCard.css).
  const x = "var(--node-socket-x, -5px)";
  const horizontal = visualSide === "input" ? { left: x } : { right: x };
  // 50% of the content wrapper, not the card, or a card with no value box centers over the header.
  const vertical =
    top === undefined
      ? { top: "var(--out-socket-top, 50%)", marginTop: -6 }
      : { top };

  const myKey = dragSocketKey(nodeId, socketKey);
  // Own flag only, so a highlight change re-renders just the sockets it touches.
  const lit = useSyncExternalStore(socketHighlightStore.subscribe, () => socketHighlightStore.isHighlighted(myKey));
  const isSquare = payload instanceof SolenoidSocket && SQUARE_TYPES.has(payload.dataType);
  const isCube = payload instanceof SolenoidSocket && payload.dataType === "cube";
  const shape = isCube ? "cube" : isSquare ? "square" : "circle";
  const typeLabel = payload instanceof SolenoidSocket ? SOCKET_TYPE_LABELS[payload.dataType] : undefined;

  const hint = hintFor(side, nodeId, socketKey);
  const hintTimer = useRef<number | null>(null);
  const [peekShown, setPeekShown] = useState(false);
  const cancelHint = () => {
    if (hintTimer.current !== null) { clearTimeout(hintTimer.current); hintTimer.current = null; }
    if (peekShown) setPeekShown(false);
    frameHintStore.close();
  };
  useEffect(() => cancelHint, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvePeekValue = (): { value: unknown; nodeId: string } | null => {
    if (side === "output") return { value: cableValueStore.get(nodeId, socketKey), nodeId };
    const conn = getActiveEditor()?.getConnections()
      .find((c) => c.target === nodeId && c.targetInput === socketKey);
    if (!conn) return null;
    return { value: cableValueStore.get(conn.source, conn.sourceOutput), nodeId: conn.source };
  };

  const hintEnter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget as HTMLElement;
    const peek = resolvePeekValue();
    const willValue = !!peek && isChipSummaryPeek(peek.value);
    if (!willValue && !hint) return;
    if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      hintTimer.current = null;
      const r = el.getBoundingClientRect();
      const anchor = { left: r.left, right: r.right, centerY: r.top + r.height / 2 };
      if (willValue) frameHintStore.open({ kind: "value", value: peek!.value, nodeId: peek!.nodeId, anchor });
      else frameHintStore.open({ kind: "example", hint: hint!, anchor });
      setPeekShown(true);
    }, willValue ? PEEK_DELAY_MS : HINT_DELAY_MS);
  };

  return (
    <div
      onPointerEnter={hintEnter}
      onPointerLeave={cancelHint}
      className={(className ?? "") + (lit ? " solenoid-socket--lit" : "")}
      style={{ position: "absolute", ...horizontal, ...vertical }}
      // The hover overlay replaces the native type tooltip while it is up.
      title={hint || peekShown ? undefined : typeLabel}
      onPointerDown={cancelHint}
      data-socket-key={socketKey}
      data-socket-side={side}
      data-node-id={nodeId}
      data-socket-shape={isSquare ? "square" : "circle"}
    >
      {FlowSocket ? (
        // Outside the RF tree (a static render with no provider) the bare glyph draws with no wiring affordance.
        <FlowSocket side={side} socketKey={socketKey} payload={payload} shape={shape} lit={lit} flipped={flipped} />
      ) : (
        <SocketComponent data={payload} />
      )}
      {lit && <SocketLitRing shape={shape} />}
    </div>
  );
}
