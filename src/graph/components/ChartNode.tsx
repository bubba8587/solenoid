import { useLayoutEffect, useRef, useState } from "react";
import type { ChartNode as ChartNodeType, ChartOp } from "../rete-nodes";
import { NodeShell, OpSelect, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { ChartView, toSeries } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";

// Grouped so the dropdown reads by family — too many types now for a seg toggle.
const OPTIONS: ReadonlyArray<OpOption<ChartOp>> = [
  { value: "column", label: "Column",  group: "Cartesian" },
  { value: "bar",    label: "Bar",     group: "Cartesian" },
  { value: "line",   label: "Line",    group: "Cartesian" },
  { value: "area",   label: "Area",    group: "Cartesian" },
  { value: "scatter", label: "Scatter", group: "Cartesian" },
  { value: "pie",       label: "Pie",    group: "Categorical" },
  { value: "radar",     label: "Radar",  group: "Categorical" },
  { value: "radialbar", label: "Radial", group: "Categorical" },
  { value: "funnel",    label: "Funnel", group: "Categorical" },
];

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 150;

export function ChartComponent({ data, emit }: NodeProps<ChartNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const series = toSeries(data.cachedResult);
  const opts = data.chartOptions;

  // The data input socket is centred vertically on the chart (its main feed),
  // measured against the card — separate from the Options socket (its own row
  // below) so the two no longer overlap.
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
      <OpSelect value={op} onChange={setOp} options={OPTIONS} />
      <div ref={chartRef} style={{ position: "relative", marginTop: 4, height: H }}>
        {series.length === 0 ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : (
          <>
            <ChartView op={op} series={series} width={W} height={H} axes opts={opts} />
            <ChartExpandButton title={opts.title || data.label || "Chart"} op={op} axes series={series} opts={opts} />
          </>
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      {/* Options: type a matplotlib-style string directly, or wire a Chart
          Builder into the socket (InlineInputs hides the field when wired). */}
      <InlineInputs node={data} emit={emit} keys={["options"]} />
    </NodeShell>
  );
}
