// [[B11]] maximalMerge, [[C26]] opArgDistinct (`mode` is an argument), [[C100]] chartIsAValue
import { useState, useSyncExternalStore } from "react";
import type { GaugeNode as GaugeNodeType, GaugeStyle } from "../rete-nodes";
import { GAUGE_STYLE_OPTIONS } from "../rete-nodes";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getOwningView } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { ChartFigure, GaugeArc, useChartColors } from "./chartView";
import type { ChartValue } from "../chartValue";
import { dropInputCables } from "./cablePrune";

// Minified (square-collapse) dial — a tiny axis-less arc filling the square.
const MINI_SIZE = 46;
const MINI_SHOW = 24;

/** The collapsed bar: the value's place between min and max, and the target as a tick. */
function MiniBar({ payload, track }: { payload: { value: number | null; target: number | null; min: number; max: number }; track: string }) {
  const span = payload.max - payload.min;
  const at = (x: number | null) => (x == null || !Number.isFinite(x) || span <= 0 ? null : Math.min(1, Math.max(0, (x - payload.min) / span)));
  const v = at(payload.value), t = at(payload.target);
  return (
    <div style={{ position: "relative", width: MINI_SIZE, height: 10, borderRadius: 3, background: track, overflow: "hidden" }}>
      {v !== null && <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${v * 100}%`, background: "var(--node-accent, var(--accent))" }} />}
      {t !== null && <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${t * 100}% - 1px)`, width: 2, background: "var(--text-bright)" }} />}
    </div>
  );
}

export function GaugeComponent({ data, emit }: NodeProps<GaugeNodeType>) {
  const [mode, setMode] = useState<GaugeStyle>(data.mode);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const { track } = useChartColors();
  const payload = data.cachedPayload;

  async function pickMode(next: GaugeStyle) {
    if (next === data.mode) return;
    // Drop the departing bar-only cables BEFORE the socket removal.
    await dropInputCables(data.id, data.keysDropped(next));
    data.setMode(next);
    setMode(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    await processGraph();
  }

  const dial = mode === "dial";
  const v = payload?.value;
  const frac = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const empty = <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  // The figure reads the gauge as a ChartValue ([[C100]] chartIsAValue).
  const cv: ChartValue = {
    __chart: true, op: "scale", values: v ?? null,
    payload: payload ?? undefined, options: data.chartOptions,
    title: data.chartOptions.title || data.label || "Gauge",
  };

  return (
    // Both square-collapse: the dial to a mini arc, the bar to a mini bar.
    <NodeShell node={data} emit={emit} squareCollapse>
      <SegToggle value={mode} options={GAUGE_STYLE_OPTIONS} onChange={(s) => void pickMode(s)} />
      <InlineInputs node={data} emit={emit} />
      {dial ? (
        <>
          {!collapsed && (payload ? <ChartFigure value={cv} width={160} height={120} /> : empty)}
          <div className="solenoid-node__collapsed-only">
            {collapsed && payload && (
              <div style={{ position: "relative", width: MINI_SIZE, height: MINI_SHOW, overflow: "hidden" }}>
                <GaugeArc pct={frac * 100} track={track} size={MINI_SIZE} />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {!collapsed && (payload ? <ChartFigure value={cv} width={data.width - 22} height={60} /> : empty)}
          <div className="solenoid-node__collapsed-only">
            {collapsed && payload && <MiniBar payload={payload} track={track} />}
          </div>
        </>
      )}
    </NodeShell>
  );
}
