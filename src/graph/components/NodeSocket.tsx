import { useSyncExternalStore, useRef, useState, useLayoutEffect, type ReactNode } from "react";
import { Presets } from "rete-react-plugin";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import type { ClassicPreset } from "rete";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { SolenoidSocket, SOCKET_TYPE_LABELS } from "../sockets";
import { cubeTransform, CUBE_FILL_PATH } from "./cubeGlyph";

const SQUARE_TYPES = new Set(["list", "strlist", "datelist", "numlist", "table", "frame"]);

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

/**
 * Measures an element's vertical center relative to its offsetParent — the
 * `.solenoid-node__content` wrapper, which sits BELOW the header — and returns the
 * `top` to hand NodeSocket so its 12×12 dot centers on that row. Because the
 * offsetParent excludes the header, this value is header-INDEPENDENT: when the
 * header grows (e.g. a 2-line title) the whole content wrapper slides down and the
 * browser carries the row + socket with it, with no re-measure. Runs in a layout
 * effect (before paint, no visible jump) and only re-renders when the value
 * actually moves — i.e. the BODY layout changed (a row added, a value box grew).
 */
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

/**
 * An `.solenoid-node__io-row` whose socket dot is auto-centered on the row by
 * measurement — immune to header height, label wrapping, and surrounding
 * layout. The dot stays anchored to the card edge (the row is not a positioning
 * context). `children` are the row's flow content (label, field, value, etc.);
 * the absolutely-positioned socket is order-independent.
 */
export function MeasuredSocketRow({
  side, socketKey, nodeId, emit, payload, children, hero = false,
}: {
  side: Side;
  socketKey: string;
  nodeId: string;
  emit: RenderEmit<ClassicScheme>;
  payload: ClassicPreset.Socket;
  children: ReactNode;
  /** A tall hero box (a FrameDisplay, a markdown summary) rather than a compact
   *  label|value row — drops the fixed 22px row height so it doesn't overflow and
   *  overlap its neighbours; the socket dot still measures onto the box centre. */
  hero?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowSocketTop(ref);
  return (
    // Output rows get a modifier so they SURVIVE collapse (a multi-output node —
    // TableInfo, SplitFrame, … — collapses to its output values, not a blank box).
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
  // Dot is 12px. Default -5 straddles the card edge for sockets anchored to the
  // card/group. Standard nodes anchor to .solenoid-node__content, which sits 1px
  // inside the card's border, so that wrapper sets --node-socket-x: -6px to pull
  // the dot back out to the exact same spot. Groups (no content wrapper) get -5.
  const x = "var(--node-socket-x, -5px)";
  const horizontal = side === "input" ? { left: x } : { right: x };
  // No explicit `top` → center on the value box via --out-socket-top, else fall
  // back to 50% of the CONTENT wrapper (the body) — not the card, so a node with
  // no value box (e.g. Boolean) centers its socket on its body row, not high up
  // over the header. Explicit `top` (from MeasuredSocketRow) is content-relative.
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

  return (
    <div
      className={(className ?? "") + (lit ? " solenoid-socket--lit" : "")}
      style={{ position: "absolute", ...horizontal, ...vertical }}
      title={typeLabel}
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
          // Class lets pill contexts hide this dot-shaped flash and draw a
          // pill-shaped one instead (see .solenoid-node__pill-socket rule).
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
              // The cube silhouette (shared transform, so it matches the oversized
              // glyph). Fill + a round-joined white stroke rounds the hexagon corners
              // and fattens past the fill to cover the ring; group opacity (not
              // per-element) so the fill/stroke overlap doesn't double into a dark rim.
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
