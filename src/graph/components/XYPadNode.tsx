import { useCallback, useRef, useState } from "react";
import type { XYPadNode as XYPadNodeType } from "../rete-nodes";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { processGraph } from "../process";

const PAD = 140;

export function XYPadComponent({ data, emit }: NodeProps<XYPadNodeType>) {
  const [fx, setFx] = useState(data.literals.fx ?? 0.5);
  const [fy, setFy] = useState(data.literals.fy ?? 0.5);
  const padRef = useRef<HTMLDivElement>(null);
  // Latest fractions during a drag — the handle follows them live, but the graph
  // only recomputes on release (processGraph per move was laggy).
  const live = useRef({ fx, fy });

  // Map a screen point to [0,1] fractions and move the handle. getBoundingClientRect
  // already folds in the canvas zoom, so the fraction is correct at any scale.
  // Y is flipped so up = 1 (the intuitive direction). Visual only — no recompute.
  const track = useCallback((clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const ny = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const upY = 1 - ny;
    live.current = { fx: nx, fy: upY };
    setFx(nx);
    setFy(upY);
  }, []);

  // Commit to the node + recompute the graph once, on release.
  const commit = useCallback(() => {
    data.literals.fx = live.current.fx;
    data.literals.fy = live.current.fy;
    void processGraph(data.id);
  }, [data]);

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div
        ref={padRef}
        style={{
          position: "relative",
          width: PAD,
          height: PAD,
          margin: "2px auto",
          borderRadius: 8,
          background: "var(--surface-sunken)",
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: `${PAD / 4}px ${PAD / 4}px`,
          border: "1px solid var(--border-strong)",
          touchAction: "none",
          cursor: "crosshair",
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          track(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0) return;
          track(e.clientX, e.clientY);
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            position: "absolute",
            left: `${fx * 100}%`,
            top: `${(1 - fy) * 100}%`,
            width: 14,
            height: 14,
            marginLeft: -7,
            marginTop: -7,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "2px solid var(--surface-sunken)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
            pointerEvents: "none",
          }}
        />
      </div>
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "x", label: "X", value: fx },
          { key: "y", label: "Y", value: fy },
        ]}
      />
    </NodeShell>
  );
}
