import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { NodeSocket } from "./NodeSocket";
import "./nodeCard.css";

type PillNode = {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket } | undefined>;
};

/** Collapsed-node aggregate for ≥2 inputs: the sockets stay functional but hidden,
 *  stacked at one point behind a single pill the cables converge on. The stacked
 *  dot flashes are suppressed in CSS, so the pill draws the highlight instead. */
export function CollapsedInputPill({
  node,
  emit,
  keys,
}: {
  node: PillNode;
  emit: RenderEmit<ClassicScheme>;
  keys: string[];
}) {
  const hlVersion = useSyncExternalStore(socketHighlightStore.subscribe, socketHighlightStore.version);
  void hlVersion;
  const lit = keys.some((k) => socketHighlightStore.isHighlighted(dragSocketKey(node.id, k)));
  const first = node.inputs[keys[0]]?.socket;
  const pillColor = first instanceof SolenoidSocket ? SOCKET_COLORS[first.dataType] : "#888";
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
            className="solenoid-node__pill-socket"
          />
        ) : null;
      })}
      {/* Inset ring fully inside the fill, so it doesn't straddle the edge. */}
      <svg className="solenoid-node__input-pill" viewBox="0 0 12 28" aria-hidden>
        <rect x="0" y="0" width="12" height="28" rx="6" fill={pillColor} />
        <rect x="1" y="1" width="10" height="26" rx="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
        {lit && (
          <rect x="0" y="0" width="12" height="28" rx="6" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
        )}
      </svg>
    </>
  );
}
