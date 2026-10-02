import type { Emit } from "./nodeKit";
import { useSyncExternalStore, type CSSProperties } from "react";
import type { ClassicPreset } from "rete";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { NodeSocket } from "./NodeSocket";
import { socketRingVar } from "./SocketComponent";
import { stopDragStart } from "../coarse";
import "./nodeCard.css";

type PillNode = {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket } | undefined>;
};

/** The sockets stay functional but hidden, stacked behind one pill; their dot flashes are suppressed in CSS, so the pill draws the highlight.
 *  `top` pins the stack to a row (a folded CardSection's caption); without it, it centers on the value box. */
export function CollapsedInputPill({
  node,
  emit,
  keys,
  top,
  onOpen,
  openTitle,
}: {
  node: PillNode;
  emit: Emit;
  keys: string[];
  top?: number;
  /** Makes the pill a button that reopens what it stands for (a folded CardSection). */
  onOpen?: () => void;
  openTitle?: string;
}) {
  const hlVersion = useSyncExternalStore(socketHighlightStore.subscribe, socketHighlightStore.version);
  void hlVersion;
  const lit = keys.some((k) => socketHighlightStore.isHighlighted(dragSocketKey(node.id, k)));
  const first = node.inputs[keys[0]]?.socket;
  const pillColor = first instanceof SolenoidSocket ? SOCKET_COLORS[first.dataType] : "var(--sock-any)";
  return (
    <>
      {keys.map((key) => {
        const input = node.inputs[key];
        return input ? (
          <NodeSocket
            key={key}
            side="input"
            socketKey={key}
            nodeId={node.id}
            emit={emit}
            payload={input.socket}
            top={top}
            className="solenoid-node__pill-socket"
          />
        ) : null;
      })}
      {/* Inset ring fully inside the fill, so it doesn't straddle the edge. */}
      <svg
        className={`solenoid-node__input-pill${onOpen ? " solenoid-node__input-pill--open" : ""}`}
        viewBox="0 0 12 28"
        aria-hidden
        style={{ ...(top === undefined ? null : { top: top - 8 }), ...(socketRingVar(pillColor) ? { "--socket-ring": socketRingVar(pillColor) } : null) } as CSSProperties}
        onPointerDown={onOpen ? stopDragStart : undefined}
        onMouseDown={onOpen ? (e) => e.stopPropagation() : undefined}
        onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(); } : undefined}
      >
        {openTitle && <title>{openTitle}</title>}
        <rect x="0" y="0" width="12" height="28" rx="6" fill={pillColor} />
        <rect x="1" y="1" width="10" height="26" rx="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        {lit && (
          <rect x="0" y="0" width="12" height="28" rx="6" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
        )}
      </svg>
    </>
  );
}
