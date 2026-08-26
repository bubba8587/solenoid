// TRANSITIONAL seam for the React Flow port (docs/react-port-plan.md; dissolves
// at C9): shared node-component code asks this module whether it renders on the
// flow surface, where sockets are React Flow Handles and every node shares the
// app React tree. The Handle component is INJECTED by the flow chunk so nothing
// on the rete surface ever imports @xyflow/react into the main bundle.
import type { ComponentType } from "react";
import type { ClassicPreset } from "rete";

export type FlowSocketProps = {
  side: "input" | "output";
  socketKey: string;
  payload: ClassicPreset.Socket;
};

let _flow = false;
let _socket: ComponentType<FlowSocketProps> | null = null;

export function setFlowSurface(socket: ComponentType<FlowSocketProps>): void {
  _flow = true;
  _socket = socket;
}

export function isFlowSurface(): boolean {
  return _flow;
}

export function getFlowSocket(): ComponentType<FlowSocketProps> | null {
  return _socket;
}
