// [[C27]] noDataInComponents, [[D10]] onePrunePath, [[E11]] controlDrivenRetype, [[C26]] opArgDistinct (`mode` is an argument), [[C100]] chartIsAValue
import { useState, useSyncExternalStore } from "react";
import type { GaugeNode as GaugeNodeType, GaugeStyle } from "../rete-nodes";
import { GAUGE_STYLE_OPTIONS } from "../rete-nodes";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getActiveView } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { ScaleDial, GaugeArc, useChartColors } from "./chartView";
import { BulletBar } from "./chartCards";
import { ChartChip } from "./ChartChip";
import type { ChartValue } from "../chartValue";
import { dropInputCables } from "./cablePrune";

// Minified (square-collapse) dial — a tiny axis-less arc filling the square.
const MINI_SIZE = 46;
const MINI_SHOW = 24;

export function GaugeComponent({ data, emit }: NodeProps<GaugeNodeType>) {
  const [mode, setMode] = useState<GaugeStyle>(data.mode);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const { track } = useChartColors();
  const payload = data.cachedPayload;

  async function pickMode(next: GaugeStyle) {
    if (next === data.mode) return;
    // [[D10]] onePrunePath: drop the departing bar-only cables BEFORE the socket removal.
    await dropInputCables(data.id, data.keysDropped(next));
    data.setMode(next);
    setMode(next);
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }

  const dial = mode === "dial";
  const v = payload?.value;
  const frac = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const empty = <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  // The collapsed bar's [Chart] chip carries a ChartValue ([[C100]] chartIsAValue), like Chart/Histogram.
  const cv: ChartValue = {
    __chart: true, op: "scale", values: v ?? null,
    payload: payload ?? undefined, options: data.chartOptions,
    title: data.chartOptions.title || data.label || "Gauge",
  };

  return (
    // Dial square-collapses to a mini arc; the bar keeps its width and collapses
    // normally — the standard chevron, like every other node.
    <NodeShell node={data} emit={emit} {...(dial ? { squareCollapse: true } : {})}>
      <SegToggle value={mode} options={GAUGE_STYLE_OPTIONS} onChange={(s) => void pickMode(s)} />
      <InlineInputs node={data} emit={emit} />
      {dial ? (
        <>
          {!collapsed && (payload ? <ScaleDial payload={payload} size={160} /> : empty)}
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
          {!collapsed && (payload ? <BulletBar payload={payload} /> : empty)}
          {/* Collapsed → the standard hero box + [Chart] chip (opens the popup), like
              Chart/Histogram — not a shrunken bar. */}
          <div className="solenoid-node__collapsed-only solenoid-node__display-value solenoid-node__display-value--chip">
            {payload && <ChartChip value={cv} />}
          </div>
        </>
      )}
    </NodeShell>
  );
}
