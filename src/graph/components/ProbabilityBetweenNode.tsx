// [[B19]] spreadsheetHabits; tree/specs/computation/probability-pack.md § Probability Between
import { useRef, useState } from "react";
import { PROB_BETWEEN_OP_META, type ProbabilityBetweenNode as Node, type ProbBetweenOp } from "../nodes/probability";
import { DIST_SPECS } from "../nodes/distributionOps";
import { InlineInputs, useConnectedInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getOwningView } from "../activeGraph";
import { processGraph } from "../process";
import {
  ACCENT, WASH, PLOT_H, PLOT_W, Bars, Strip, areaPath, linePath, pairs, px, scaleOf, valueAt,
} from "./probabilityPlot";

const OPTIONS = (Object.keys(PROB_BETWEEN_OP_META) as ProbBetweenOp[]).map((op) => ({
  value: op, label: PROB_BETWEEN_OP_META[op].label, group: PROB_BETWEEN_OP_META[op].group,
}));

type End = "lo" | "hi";

/** A dragged value rounded to a step the picture can show: whole numbers for a count, else about 1/200 of the span. */
function snap(v: number, span: number, whole: boolean): number {
  if (whole) return Math.round(v);
  const places = Math.min(10, Math.max(0, Math.ceil(-Math.log10(span / 200))));
  return Number(v.toFixed(places));
}

export function ProbabilityBetweenComponent({ data, emit }: NodeProps<Node>) {
  const [op, setOpField] = useNodeField(data, "op");
  const wired = useConnectedInputs(data.id);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<End | null>(null);
  const frame = useRef<number | null>(null);
  const [live, setLive] = useState<{ end: End; v: number } | null>(null);

  async function pick(next: ProbBetweenOp) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setOp(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    setOpField(next);
  }

  const pts = pairs(data.plotX, data.plotY);
  const bars = data.plotBars;
  const s = scaleOf([pts], bars && pts.length > 1 ? (pts[1][0] - pts[0][0]) / 2 : 0);
  const at = (end: End): number | null => (live?.end === end ? live.v : end === "lo" ? data.shadeLo : data.shadeHi);
  const lo = at("lo") ?? -Infinity, hi = at("hi") ?? Infinity;
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  const whole = DIST_SPECS[op].group === "Discrete";

  // Over bars a handle sits on the outer edge of the last bar it takes in, so a bar is plainly in or out.
  const edge = (end: End) => (bars ? (end === "lo" ? -0.5 : 0.5) : 0);
  const valueFrom = (clientX: number, end: End): number | null => {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r || !s) return null;
    const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return snap(valueAt(s, fx) - edge(end), s.x1 - s.x0, whole);
  };
  const handleX = (end: End): number => {
    const v = at(end);
    if (!s || v == null) return end === "lo" ? 0 : 1;
    return Math.min(1, Math.max(0, px(s, v + edge(end)) / PLOT_W));
  };
  const nearest = (clientX: number): End | null => {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r) return null;
    const f = (clientX - r.left) / r.width;
    const free = (["lo", "hi"] as End[]).filter((e) => !wired.has(e));
    if (free.length === 0) return null;
    return free.reduce((best, e) => (Math.abs(handleX(e) - f) < Math.abs(handleX(best) - f) ? e : best));
  };
  const write = (end: End, v: number) => {
    data.literals[end] = v;
    setLive({ end, v });
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; void processGraph(data.id); });
  };
  // Ends dragged past each other trade places, so Low never reads above High.
  const release = () => {
    if (!dragging.current) return;
    dragging.current = null;
    setLive(null);
    const { lo: l, hi: h } = data.literals;
    if (l != null && h != null && l > h) {
      [data.literals.lo, data.literals.hi] = [h, l];
      void processGraph(data.id);
    }
  };

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pick(o)} options={OPTIONS} />
      <Strip
        divRef={stripRef}
        className="nodrag nopan"
        style={{ touchAction: "none", cursor: s ? "ew-resize" : "default" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button !== 0 || !s) return;
          const end = nearest(e.clientX);
          const v = end && valueFrom(e.clientX, end);
          if (!end || v == null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = end;
          write(end, v);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const v = valueFrom(e.clientX, dragging.current);
          if (v != null) write(dragging.current, v);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const end = nearest(e.clientX);
          if (!end) return;
          delete data.literals[end];
          void processGraph(data.id);
        }}
      >
        {s && (bars
          ? <Bars s={s} pts={pts} inRange={(x) => x >= a && x <= b} />
          : <>
            <path d={areaPath(s, pts, a, b)} fill={WASH} />
            <path d={linePath(s, pts)} fill="none" stroke={ACCENT} strokeWidth={1.75} />
          </>)}
        {s && (["lo", "hi"] as End[]).map((end) => {
          const x = handleX(end) * PLOT_W;
          return (
            <g key={end} opacity={wired.has(end) ? 0.45 : 1}>
              <line x1={x} x2={x} y1={0} y2={PLOT_H} stroke={ACCENT} strokeWidth={1.5} />
              <circle cx={x} cy={PLOT_H - 7} r={4.5} fill={ACCENT} stroke="var(--surface-sunken)" strokeWidth={1.5} />
            </g>
          );
        })}
      </Strip>
      <InlineInputs node={data} emit={emit} keys={["lo", "hi", ...data.paramKeys]} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
