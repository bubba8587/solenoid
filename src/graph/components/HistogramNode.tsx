import { useLayoutEffect, useRef, useState } from "react";
import type { HistogramNode as HistogramNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { ChartView, toSeries } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 150;

export function HistogramComponent({ data, emit }: NodeProps<HistogramNodeType>) {
  const series = toSeries(data.cachedResult);
  const opts = data.chartOptions;

  // The Values feed socket is centred on the plot (its main input), measured
  // against the card — separate from the Bins / Options rows below it.
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
      collapsible={false}
      leading={valuesPort && valuesTop !== undefined
        ? <NodeSocket side="input" socketKey="values" nodeId={data.id} emit={emit} payload={valuesPort.socket} top={valuesTop} />
        : null}
    >
      <div ref={chartRef} style={{ position: "relative", height: H }}>
        {series.length === 0 ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : (
          <>
            <ChartView op="column" series={series} width={W} height={H} axes opts={opts} />
            <ChartExpandButton title={opts.title || data.label || "Histogram"} op="column" axes series={series} opts={opts} />
          </>
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      <InlineInputs node={data} emit={emit} keys={["bins", "options"]} />
    </NodeShell>
  );
}
