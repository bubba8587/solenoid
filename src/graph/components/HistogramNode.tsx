import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HistogramNode as HistogramNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { ChartView, toSeries } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import type { ChartValue } from "../chartValue";

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 150;

export function HistogramComponent({ data, emit }: NodeProps<HistogramNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const series = toSeries(data.cachedResult);
  const opts = data.chartOptions;
  const chartValue: ChartValue = {
    __chart: true, op: "column", values: data.cachedResult ?? [],
    options: opts, title: opts.title || data.label || "Histogram",
  };

  // The Values socket centers on the PLOT, measured against the card.
  const chartRef = useRef<HTMLDivElement>(null);
  const [valuesTop, setValuesTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const t = el.offsetTop + el.offsetHeight / 2 - 6;
    setValuesTop((prev) => (prev === t ? prev : t));
  });
  const valuesPort = data.inputs.values;

  return (
    <NodeShell
      node={data}
      emit={emit}
      // Collapsed folds this socket into the pill — the plot it centers on is gone.
      leading={!collapsed && valuesPort && valuesTop !== undefined
        ? <NodeSocket side="input" socketKey="values" nodeId={data.id} emit={emit} payload={valuesPort.socket} top={valuesTop} />
        : null}
    >
      <div ref={chartRef} style={{ position: "relative", height: H }}>
        {series.length === 0 ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && (
          <>
            <ChartView op="column" series={series} width={W} height={H} axes opts={opts} />
            <ChartExpandButton title={opts.title || data.label || "Histogram"} op="column" axes series={series} opts={opts} />
          </>
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      <InlineInputs node={data} emit={emit} keys={collapsed ? ["values", "bins", "options"] : ["bins", "options"]} />
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup),
          right-aligned like every other value chip. */}
      <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={chartValue} /></div>
    </NodeShell>
  );
}
