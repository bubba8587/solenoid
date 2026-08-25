import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { CurveNode as CurveNodeType } from "../rete-nodes";
import { curvePoints, pointsToText, monotoneCubic, sampleCurve, curveToFrame } from "../nodes/control";
import { NodeShell, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { MeasuredSocketRow } from "./NodeSocket";
import { InlineNumberField } from "./inlineInput";
import { processGraph } from "../process";

// A curve keeps ≥ 2 control points; the monotone spline through them draws live and
// the node samples it into a list.

const PAD_W = 196;
const PAD_H = 110;
const HIT_PX = 9;

const stripStyle: CSSProperties = {
  position: "relative",
  width: PAD_W,
  height: PAD_H,
  margin: "2px auto",
  borderRadius: 8,
  background: "var(--surface-sunken)",
  backgroundImage:
    "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
  backgroundSize: `${PAD_W / 6}px ${PAD_H / 4}px`,
  border: "1px solid var(--border-strong)",
  touchAction: "none",
  cursor: "crosshair",
  overflow: "hidden",
};

export function CurveComponent({ data, emit }: NodeProps<CurveNodeType>) {
  const [pts, setPts] = useState<Array<[number, number]>>(() => curvePoints(data.pointsText));
  const padRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const live = useRef(pts);

  const xmin = data.literals.xmin ?? 0, xmax = data.literals.xmax ?? 1;
  const ymin = data.literals.ymin ?? 0, ymax = data.literals.ymax ?? 1;
  const xspan = xmax - xmin || 1, yspan = ymax - ymin || 1;

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

  const sortByX = (arr: Array<[number, number]>) => [...arr].sort((a, b) => a[0] - b[0]);
  const update = (next: Array<[number, number]>) => { live.current = next; setPts(next); };
  const commit = () => {
    update(sortByX(live.current));
    data.pointsText = pointsToText(live.current);
    void processGraph(data.id);
  };
  const removeAt = (i: number) => {
    if (live.current.length <= 2) return; // a curve keeps at least its endpoints
    update(live.current.filter((_, k) => k !== i));
    commit();
  };
  const setLit = (key: "xmin" | "xmax" | "ymin" | "ymax" | "samples") => (v: number) => {
    data.literals[key] = v;
    void processGraph(data.id);
  };

  // Display only — the node's own sampling drives the outputs.
  const path = useMemo(() => {
    const sorted = sortByX(pts);
    if (sorted.length === 0) return "";
    const f = monotoneCubic(sorted.map((p) => p[0]), sorted.map((p) => p[1]));
    const seg: string[] = [];
    for (let px = 0; px <= PAD_W; px += 2) {
      const x = xmin + (px / PAD_W) * xspan;
      const y = f(x);
      const py = (1 - (y - ymin) / yspan) * PAD_H;
      seg.push(`${seg.length ? "L" : "M"}${px},${Math.max(-4, Math.min(PAD_H + 4, py)).toFixed(1)}`);
    }
    return seg.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, xmin, xmax, ymin, ymax]);

  // NEVER data.data(): the engine wraps it with the coercion boundary, which expects
  // an inputs record, so calling it bare throws and kills the card.
  const sampled = sampleCurve(data.pointsText, xmin, xmax, data.literals.samples ?? 32);

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div
        ref={padRef}
        style={stripStyle}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const hit = hitTest(e.clientX, e.clientY);
          if (e.altKey) { if (hit != null) removeAt(hit); dragIdx.current = null; return; }
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
          e.preventDefault();
          e.stopPropagation();
          const hit = hitTest(e.clientX, e.clientY);
          if (hit != null) removeAt(hit);
        }}
      >
        <svg width={PAD_W} height={PAD_H} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.75} />
        </svg>
        {pts.map((p, i) => {
          const [x, y] = toPx(p);
          if (x < -6 || x > PAD_W + 6 || y < -6 || y > PAD_H + 6) return null;
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
      <div className="solenoid-node__io-row" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>X</span>
        <InlineNumberField value={xmin} onChange={(v) => setLit("xmin")(v ?? 0)} />
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>–</span>
        <InlineNumberField value={xmax} onChange={(v) => setLit("xmax")(v ?? 1)} />
      </div>
      <div className="solenoid-node__io-row" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>Y</span>
        <InlineNumberField value={ymin} onChange={(v) => setLit("ymin")(v ?? 0)} />
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>–</span>
        <InlineNumberField value={ymax} onChange={(v) => setLit("ymax")(v ?? 1)} />
      </div>
      <div className="solenoid-node__io-row" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>Samples</span>
        <InlineNumberField value={data.literals.samples ?? 32} onChange={(v) => setLit("samples")(v ?? 32)} />
      </div>
      <div className="solenoid-node__section-divider" />
      {data.outputs.result && (
        <MeasuredSocketRow hero side="output" socketKey="result" nodeId={data.id} emit={emit} payload={data.outputs.result.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={curveToFrame(sampled.xs, sampled.values)} label={data.label} /></div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}
