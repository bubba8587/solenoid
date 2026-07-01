import { useLayoutEffect, useRef, useState } from "react";
import type { ChartNode as ChartNodeType, ChartOp } from "../rete-nodes";
import { NodeShell, useNodeField, type NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { SegToggle } from "./SegToggle";
import { ChartView, toSeries } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";

const OPTIONS: ReadonlyArray<{ value: ChartOp; label: string; title?: string }> = [
  { value: "column", label: "Col",  title: "Column (vertical bars)" },
  { value: "bar",    label: "Bar",  title: "Bar (horizontal)" },
  { value: "line",   label: "Line" },
  { value: "area",   label: "Area" },
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
      <SegToggle value={op} onChange={setOp} options={OPTIONS} />
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
