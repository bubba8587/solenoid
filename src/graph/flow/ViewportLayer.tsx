// [[C120]] linearWork
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";

/** React Flow's `ViewportPortal`, minus its per-update DOM query: that one re-runs `querySelector` over the whole canvas in its store selector on every pan frame. This finds the portal target once. */
export function ViewportLayer({ children }: { children: ReactNode }) {
  const domNode = useStore((s) => s.domNode);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTarget(domNode?.querySelector<HTMLElement>(".react-flow__viewport-portal") ?? null);
  }, [domNode]);
  return target ? createPortal(children, target) : null;
}
