// [[C43]] oneFlowSurface, [[B10]] reactFlowView
// The socket / resize-grip injection seam: RF Handles and NodeResizeControls work only
// INSIDE a ReactFlow tree, so the context gates them (a bare card render falls back to
// the plain SocketComponent and no grip). Registered, not imported: a direct import
// would be a NodeSocket ↔ FlowSocketHandle cycle.
import { createContext, useContext, type ComponentType, type CSSProperties, type ReactNode } from "react";
import type { ClassicPreset } from "rete";

export type FlowSocketProps = {
  side: "input" | "output";
  socketKey: string;
  payload: ClassicPreset.Socket;
  shape: "circle" | "square" | "cube";
  /** Already lit by the app's own highlight store (no second ring). */
  lit: boolean;
  /** The node's sockets are flipped left<->right — the Handle draws on the opposite
   *  edge. The `type` (target/source) stays semantic; only the visual side moves. */
  flipped?: boolean;
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

/** True on the marketing stages (landing hero, scene stages) that want the entrance
 *  choreography: cards pop in, then every cable draws itself socket-to-socket. The main
 *  app surface leaves it false so working edits never animate. */
export const FlowRevealContext = createContext(false);

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
