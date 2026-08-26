import type { Emit } from "./nodeKit";
import { useSyncExternalStore, useRef, useState, useLayoutEffect, useEffect, type ReactNode } from "react";
import type { ClassicPreset } from "rete";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { useFlowSocket } from "../flowSurface";
import { SolenoidSocket, SOCKET_TYPE_LABELS } from "../sockets";
import { frameHintFor, frameHintStore, type FrameHint } from "../frameHint";
import { getActiveEditor } from "../activeGraph";
import { cubeTransform, CUBE_FILL_PATH } from "./cubeGlyph";
import { SocketComponent, LIST_TYPES, TABLE_TYPES, COMBO_COLORS } from "./SocketComponent";

// Hover-intent delay before the example hint pops (tooltip-like; a cable drag
// crossing sockets must not flash tables).
const HINT_DELAY_MS = 300;

/** The declared example hint for this input, if its node's class carries one. */
function hintFor(side: Side, nodeId: string, socketKey: string): FrameHint | undefined {
  if (side !== "input") return undefined;
  const node = getActiveEditor()?.getNode(nodeId);
  return node ? frameHintFor(node, socketKey) : undefined;
}

// Every dataType SocketComponent draws as a rounded SQUARE (so the hover/lit highlight and
// the ::before hit area mirror the dot instead of defaulting to a circle). Derived from the
// SAME sets SocketComponent renders from — a combo/list/table can't drift into a round halo.
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

/** Measures against the `.solenoid-node__content` offsetParent, which sits BELOW the
 *  header, so the returned `top` needs no re-measure when the header grows. */
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

/** The dot stays anchored to the card edge — the row must NOT become a positioning
 *  context. */
export function MeasuredSocketRow({
  side, socketKey, nodeId, emit, payload, children, hero = false,
}: {
  side: Side;
  socketKey: string;
  nodeId: string;
  emit?: Emit;
  payload: ClassicPreset.Socket;
  children: ReactNode;
  /** A tall box rather than a compact label|value row: drops the fixed 22px row height
   *  so it can't overlap its neighbors. */
  hero?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowSocketTop(ref);
  // Touch trigger for the frame-input example hint: the DOT scales with the
  // canvas transform (a few px at overview zooms — no fingertip lands on it),
  // so on touch the WHOLE ROW is the tap target. Form controls in the row keep
  // their own tap meaning.
  const rowHintTap = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("input, select, textarea, button, [contenteditable='true']")) return;
    const hint = hintFor(side, nodeId, socketKey);
    if (!hint) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    frameHintStore.open({ hint, anchor: { left: r.left, right: r.right, centerY: r.top + r.height / 2 } });
  };
  return (
    // Output rows get a modifier so they SURVIVE collapse into the output values.
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

export function NodeSocket({ side, socketKey, nodeId, payload, top, className }: Props) {
  const FlowSocket = useFlowSocket();
  // The 12px dot straddles the card edge: -5 for card/group-anchored sockets, while
  // .solenoid-node__content sits 1px inside the border and sets --node-socket-x: -6px.
  const x = "var(--node-socket-x, -5px)";
  const horizontal = side === "input" ? { left: x } : { right: x };
  // No explicit `top` → center on the value box via --out-socket-top, else 50% of the
  // CONTENT wrapper — not the card, or a node with no value box centers over the header.
  const vertical =
    top === undefined
      ? { top: "var(--out-socket-top, 50%)", marginTop: -6 }
      : { top };

  const myKey = dragSocketKey(nodeId, socketKey);
  const version = useSyncExternalStore(socketHighlightStore.subscribe, socketHighlightStore.version);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void version;
  const lit = socketHighlightStore.isHighlighted(myKey);
  const isSquare = payload instanceof SolenoidSocket && SQUARE_TYPES.has(payload.dataType);
  const isCube = payload instanceof SolenoidSocket && payload.dataType === "cube";
  const typeLabel = payload instanceof SolenoidSocket ? SOCKET_TYPE_LABELS[payload.dataType] : undefined;

  // Frame-input example hint (frameHint.ts) — the MOUSE half: hover-intent on
  // the dot shows it; leaving, pressing (a cable pick), or unmount hides it.
  // The dot deliberately has NO touch trigger: a touch press on the dot begins
  // the cable pick, which captures the pointer, so the tap's pointerup never
  // reaches this wrapper — the TOUCH trigger is the whole row
  // (MeasuredSocketRow, the intentional mobile path; touch-gestures.md).
  const hint = hintFor(side, nodeId, socketKey);
  const hintTimer = useRef<number | null>(null);
  const cancelHint = () => {
    if (hintTimer.current !== null) { clearTimeout(hintTimer.current); hintTimer.current = null; }
    frameHintStore.close();
  };
  useEffect(() => cancelHint, []);
  const hintEnter = hint
    ? (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        const el = e.currentTarget as HTMLElement;
        if (hintTimer.current !== null) clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => {
          hintTimer.current = null;
          const r = el.getBoundingClientRect();
          frameHintStore.open({ hint, anchor: { left: r.left, right: r.right, centerY: r.top + r.height / 2 } });
        }, HINT_DELAY_MS);
      }
    : undefined;

  return (
    <div
      onPointerEnter={hintEnter}
      onPointerLeave={hint ? cancelHint : undefined}
      className={(className ?? "") + (lit ? " solenoid-socket--lit" : "")}
      style={{ position: "absolute", ...horizontal, ...vertical }}
      // The hint replaces the native type tooltip (both at once would overlap).
      title={hint ? undefined : typeLabel}
      onPointerDown={hint ? cancelHint : undefined}
      data-socket-key={socketKey}
      data-socket-side={side}
      data-node-id={nodeId}
      data-socket-shape={isSquare ? "square" : "circle"}
    >
      {FlowSocket ? (
        // Inside the RF tree the dot is an RF Handle (injected — no @xyflow
        // import here). Outside it (a static render with no provider) the bare
        // glyph draws with no wiring affordance.
        <FlowSocket side={side} socketKey={socketKey} payload={payload} />
      ) : (
        <SocketComponent data={payload} />
      )}
      {lit && (
        <svg
          aria-hidden="true"
          // Class lets pill contexts hide this dot-shaped flash and draw a pill instead.
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
          {isCube
            ? (
              // Group opacity (never per-element), or the fill/stroke overlap doubles
              // into a dark rim.
              <g transform={cubeTransform(1)} opacity="0.35" style={{ mixBlendMode: "overlay" }}>
                <path d={CUBE_FILL_PATH} fill="white" stroke="white" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            )
            : isSquare
            ? <rect x="0" y="0" width="12" height="12" rx="1.5" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
            : <circle cx="6" cy="6" r="6" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
          }
        </svg>
      )}
    </div>
  );
}
