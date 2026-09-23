// [[C43]] oneFlowSurface, [[B10]] reactFlowView
// RF Handles and resize controls work only inside a ReactFlow tree, so the context gates them. Registered, not
// imported: a direct import would be a NodeSocket ↔ FlowSocketHandle cycle.
import { createContext, useContext, type ComponentType, type CSSProperties, type ReactNode } from "react";
import type { ClassicPreset } from "rete";

export type FlowSocketProps = {
  side: "input" | "output";
  socketKey: string;
  payload: ClassicPreset.Socket;
  shape: "circle" | "square" | "cube";
  /** Already lit by the app's own highlight store (no second ring). */
  lit: boolean;
  /** The Handle draws on the opposite edge; `type` (target or source) stays semantic. */
  flipped?: boolean;
};

export type FlowResizeGripProps = {
  className?: string;
  style?: CSSProperties;
  minWidth?: number;
  minHeight?: number;
  onResizeStart?: (size: { width: number; height: number }) => void;
  onResize: (size: { width: number; height: number }) => void;
  onResizeEnd?: (size: { width: number; height: number }) => void;
  onDoubleClick?: () => void;
  children?: ReactNode;
};

let _socket: ComponentType<FlowSocketProps> | null = null;
let _grip: ComponentType<FlowResizeGripProps> | null = null;

export const FlowSurfaceContext = createContext(false);

/** True on the marketing stages that want the entrance choreography; the main app leaves it false so edits never animate. */
export const FlowRevealContext = createContext(false);

export function registerFlowSocket(socket: ComponentType<FlowSocketProps>): void {
  _socket = socket;
}

export function useFlowSocket(): ComponentType<FlowSocketProps> | null {
  const inFlow = useContext(FlowSurfaceContext);
  return inFlow ? _socket : null;
}

export function registerFlowResizeGrip(grip: ComponentType<FlowResizeGripProps>): void {
  _grip = grip;
}

export function useFlowResizeGrip(): ComponentType<FlowResizeGripProps> | null {
  const inFlow = useContext(FlowSurfaceContext);
  return inFlow ? _grip : null;
}
