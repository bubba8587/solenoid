// TRANSITIONAL seam for the React Flow port (docs/react-port-plan.md; dissolves
// at C9): shared node-component code asks this module whether it is rendering
// INSIDE the React Flow tree, where sockets are RF Handles. Detection is a
// React CONTEXT, not a global flag — the rete-based drill-in overlay renders
// node components in its own React roots on top of the flow surface, and those
// must keep the rete socket path. The Handle component is INJECTED by the flow
// chunk so nothing on the rete surface ever imports @xyflow/react.
import { createContext, useContext, type ComponentType } from "react";
import type { ClassicPreset } from "rete";

export type FlowSocketProps = {
  side: "input" | "output";
  socketKey: string;
  payload: ClassicPreset.Socket;
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
