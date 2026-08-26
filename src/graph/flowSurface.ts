// The socket-injection seam: node components render sockets as RF Handles,
// but the Handle component is INJECTED by the flow chunk (registerFlowSocket)
// so shared component code never imports @xyflow/react — the flow chunk stays
// the only owner of that dependency. The context gates rendering outside an
// RF tree (a bare component render falls back to the plain SocketComponent).
import { createContext, useContext, type ComponentType } from "react";
import type { ClassicPreset } from "rete";

export type FlowSocketProps = {
  side: "input" | "output";
  socketKey: string;
  payload: ClassicPreset.Socket;
  shape: "circle" | "square" | "cube";
  /** Already lit by the app's own highlight store (no second ring). */
  lit: boolean;
};

let _socket: ComponentType<FlowSocketProps> | null = null;

/** True only under FlowCanvas's provider — i.e. inside the RF tree. */
export const FlowSurfaceContext = createContext(false);

export function registerFlowSocket(socket: ComponentType<FlowSocketProps>): void {
  _socket = socket;
}

/** The injected Handle component when this render sits in the RF tree. */
export function useFlowSocket(): ComponentType<FlowSocketProps> | null {
  const inFlow = useContext(FlowSurfaceContext);
  return inFlow ? _socket : null;
}
