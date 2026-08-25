import { useRef, useState, type CSSProperties } from "react";
import type { PointPlotterNode as PointPlotterNodeType } from "../rete-nodes";
import { parsePoints, pointsToText, pointsToFrame } from "../nodes/control";
import { NodeShell, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { MeasuredSocketRow } from "./NodeSocket";
import { InlineNumberField } from "./inlineInput";
import { processGraph } from "../process";

// Live handle, graph recomputes on release — the XY Pad's interaction economy.

const PAD_W = 196;
const PAD_H = 140;
const HIT_PX = 9; // pointer-to-point grab distance

const padStyle: CSSProperties = {
  position: "relative",
  width: PAD_W,
  height: PAD_H,
  margin: "2px auto",
  borderRadius: 8,
  background: "var(--surface-sunken)",
  backgroundImage:
    "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
  backgroundSize: `${PAD_W / 6}px ${PAD_H / 5}px`,
  border: "1px solid var(--border-strong)",
  touchAction: "none",
  cursor: "crosshair",
  overflow: "hidden",
};

// Ranges are literals, not sockets: they are the pad's coordinate frame, not data.
function RangeRow({ label, lo, hi, onLo, onHi }: {
  label: string; lo: number; hi: number; onLo: (v: number) => void; onHi: (v: number) => void;
}) {
  return (
    <div className="solenoid-node__io-row" style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>{label}</span>
      <InlineNumberField value={lo} onChange={(v) => onLo(v ?? 0)} />
      <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>–</span>
      <InlineNumberField value={hi} onChange={(v) => onHi(v ?? 0)} />
    </div>
  );
}

export function PointPlotterComponent({ data, emit }: NodeProps<PointPlotterNodeType>) {
  const [pts, setPts] = useState<Array<[number, number]>>(() => parsePoints(data.pointsText));
  const padRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const live = useRef(pts);

  const xmin = data.literals.xmin ?? 0, xmax = data.literals.xmax ?? 10;
  const ymin = data.literals.ymin ?? 0, ymax = data.literals.ymax ?? 10;
  const xspan = xmax - xmin || 1, yspan = ymax - ymin || 1;

  // Value ↔ pad-pixel mapping (y flipped: up = larger).
  const toPx = (p: readonly [number, number]): [number, number] =>
    [((p[0] - xmin) / xspan) * PAD_W, (1 - (p[1] - ymin) / yspan) * PAD_H];
  const toVal = (clientX: number, clientY: number): [number, number] => {
    const r = padRef.current!.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return [xmin + fx * xspan, ymin + (1 - fy) * yspan];
  };
  const hitTest = (clientX: number, clientY: number): number | null => {
    const r = padRef.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * PAD_W, py = ((clientY - r.top) / r.height) * PAD_H;
    let best: number | null = null, bestD = HIT_PX;
    live.current.forEach((p, i) => {
      const [x, y] = toPx(p);
      const d = Math.hypot(x - px, y - py);
      if (d <= bestD) { best = i; bestD = d; }
    });
    return best;
  };

  const update = (next: Array<[number, number]>) => { live.current = next; setPts(next); };
  const commit = () => {
    data.pointsText = pointsToText(live.current);
    void processGraph(data.id);
  };
  const setRange = (key: "xmin" | "xmax" | "ymin" | "ymax") => (v: number) => {
    data.literals[key] = v;
    void processGraph(data.id);
  };

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div
        ref={padRef}
        style={padStyle}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const hit = hitTest(e.clientX, e.clientY);
          if (e.altKey) {
            if (hit != null) { update(live.current.filter((_, i) => i !== hit)); commit(); }
            dragIdx.current = null;
            return;
          }
          if (hit != null) {
            dragIdx.current = hit;
          } else {
            const next: Array<[number, number]> = [...live.current, toVal(e.clientX, e.clientY)];
            dragIdx.current = next.length - 1;
            update(next);
          }
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 || dragIdx.current == null) return;
          const next = [...live.current];
          next[dragIdx.current] = toVal(e.clientX, e.clientY);
          update(next);
        }}
        onPointerUp={() => { if (dragIdx.current != null) { dragIdx.current = null; commit(); } }}
        onPointerCancel={() => { if (dragIdx.current != null) { dragIdx.current = null; commit(); } }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          // Never open the canvas menu from inside the pad.
          e.preventDefault();
          e.stopPropagation();
          const hit = hitTest(e.clientX, e.clientY);
          if (hit != null) { update(live.current.filter((_, i) => i !== hit)); commit(); }
        }}
      >
        {pts.map((p, i) => {
          const [x, y] = toPx(p);
          if (x < -6 || x > PAD_W + 6 || y < -6 || y > PAD_H + 6) return null; // off-range after a range edit
          return (
            <div
              key={i}
              style={{
                position: "absolute", left: x, top: y, width: 10, height: 10,
                marginLeft: -5, marginTop: -5, borderRadius: "50%",
                background: "var(--accent)", border: "1.5px solid var(--surface-sunken)",
                pointerEvents: "none",
              }}
            />
          );
        })}
      </div>
      <RangeRow label="X" lo={xmin} hi={xmax} onLo={setRange("xmin")} onHi={setRange("xmax")} />
      <RangeRow label="Y" lo={ymin} hi={ymax} onLo={setRange("ymin")} onHi={setRange("ymax")} />
      <div className="solenoid-node__section-divider" />
      {data.outputs.result && (
        <MeasuredSocketRow hero side="output" socketKey="result" nodeId={data.id} emit={emit} payload={data.outputs.result.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={pointsToFrame(pts)} label={data.label} /></div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}
