import { useSyncExternalStore, useRef, useState, useLayoutEffect, useEffect, type ReactNode } from "react";
import { Presets } from "rete-react-plugin";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import type { ClassicPreset } from "rete";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { SolenoidSocket, SOCKET_TYPE_LABELS } from "../sockets";
import { frameHintFor, frameHintStore, type FrameHint } from "../frameHint";
import { getActiveEditor } from "../activeGraph";
import { cubeTransform, CUBE_FILL_PATH } from "./cubeGlyph";

// Hover-intent delay before the example hint pops (tooltip-like; a cable drag
// crossing sockets must not flash tables).
const HINT_DELAY_MS = 300;

/** The declared example hint for this input, if its node's class carries one. */
function hintFor(side: Side, nodeId: string, socketKey: string): FrameHint | undefined {
  if (side !== "input") return undefined;
  const node = getActiveEditor()?.getNode(nodeId);
  return node ? frameHintFor(node, socketKey) : undefined;
}

const SQUARE_TYPES = new Set(["list", "strlist", "datelist", "numlist", "table", "frame", "chart", "document"]);

const { RefSocket } = Presets.classic;

type Side = "input" | "output";

type Props = {
  side: Side;
  socketKey: string;
  nodeId: string;
  emit: RenderEmit<ClassicScheme>;
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
  emit: RenderEmit<ClassicScheme>;
  payload: ClassicPreset.Socket;
  children: ReactNode;
  /** A tall box rather than a compact label|value row: drops the fixed 22px row height
   *  so it can't overlap its neighbors. */
  hero?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowSocketTop(ref);
  return (
    // Output rows get a modifier so they SURVIVE collapse into the output values.
    <div ref={ref} className={"solenoid-node__io-row" + (side === "output" ? " solenoid-node__io-row--output" : "") + (hero ? " solenoid-node__io-row--hero" : "")}>
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

export function NodeSocket({ side, socketKey, nodeId, emit, payload, top, className }: Props) {
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

  // Frame-input example hint (frameHint.ts). Mouse: hover-intent shows it beside
  // the socket; leaving, pressing (a cable pick), or unmount hides it. Touch: no
  // hover exists, so a completed TAP on the socket (up ON the dot — a cable drag
  // releases elsewhere) shows it; the layer dismisses on the next tap / timeout.
  const hint = hintFor(side, nodeId, socketKey);
  const hintTimer = useRef<number | null>(null);
  const cancelHint = () => {
    if (hintTimer.current !== null) { clearTimeout(hintTimer.current); hintTimer.current = null; }
    frameHintStore.close();
  };
  useEffect(() => cancelHint, []);
  const showHint = (el: HTMLElement) => {
    if (!hint) return;
    const r = el.getBoundingClientRect();
    frameHintStore.open({ hint, anchor: { left: r.left, right: r.right, centerY: r.top + r.height / 2 } });
  };
  const hintEnter = hint
    ? (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        const el = e.currentTarget as HTMLElement;
        if (hintTimer.current !== null) clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => {
          hintTimer.current = null;
          showHint(el);
        }, HINT_DELAY_MS);
      }
    : undefined;
  const hintTap = hint
    ? (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") return;
        showHint(e.currentTarget as HTMLElement);
      }
    : undefined;

  return (
    <div
      className={(className ?? "") + (lit ? " solenoid-socket--lit" : "")}
      style={{ position: "absolute", ...horizontal, ...vertical }}
      // The hint replaces the native type tooltip (both at once would overlap).
      title={hint ? undefined : typeLabel}
      onPointerEnter={hintEnter}
      onPointerLeave={hint ? cancelHint : undefined}
      onPointerDown={hint ? cancelHint : undefined}
      onPointerUp={hintTap}
      data-socket-key={socketKey}
      data-socket-side={side}
      data-node-id={nodeId}
      data-socket-shape={isSquare ? "square" : "circle"}
    >
      <RefSocket
        name={`${side}-socket`}
        side={side}
        socketKey={socketKey}
        nodeId={nodeId}
        emit={emit}
        payload={payload}
      />
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
