// The socket / resize-grip injection seam. Node components render sockets as RF
// Handles and grips as RF NodeResizeControls, both of which only work INSIDE a
// ReactFlow tree; the context gates that (a bare card render falls back to the plain
// SocketComponent and no grip). The components are registered rather than imported
// because FlowSocketHandle draws NodeSocket's own glyphs — a direct import would be
// a NodeSocket ↔ FlowSocketHandle cycle.
import { createContext, useContext, type ComponentType, type CSSProperties, type ReactNode } from "react";
import type { ClassicPreset } from "rete";

export type FlowSocketProps = {
  side: "input" | "output";
  socketKey: string;
  payload: ClassicPreset.Socket;
  shape: "circle" | "square" | "cube";
  /** Already lit by the app's own highlight store (no second ring). */
  lit: boolean;
};

/** A resize grip on a card corner (RF NodeResizeControl): the host reports canvas-unit
 *  sizes from the card's MEASURED box + pointer delta, snapped live under snapToGrid. */
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

export function registerFlowResizeGrip(grip: ComponentType<FlowResizeGripProps>): void {
  _grip = grip;
}

/** The injected resize grip when this render sits in the RF tree. */
export function useFlowResizeGrip(): ComponentType<FlowResizeGripProps> | null {
  const inFlow = useContext(FlowSurfaceContext);
  return inFlow ? _grip : null;
}
