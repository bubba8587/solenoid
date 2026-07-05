import { useLayoutEffect, useRef, useState } from "react";
import type { ChartNode as ChartNodeType, ChartOp } from "../rete-nodes";
import { CHART_MATRIX_OPS } from "../rete-nodes";
import { NodeShell, OpSelect, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { ChartFigure, toSeries, type ChartShape } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import type { ChartValue } from "../chartValue";

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
  { value: "composed",  label: "Composed", group: "Multi-series (wire Series)" },
  { value: "bubble",    label: "Bubble",   group: "Multi-series (wire Series)" },
];

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 150;

export function ChartComponent({ data, emit }: NodeProps<ChartNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const opts = data.chartOptions;
  const isMatrix = CHART_MATRIX_OPS.has(op);
  // Has anything to draw? Matrix ops read cachedMatrix (with a values fallback);
  // 1-D ops read the values series.
  const hasMatrix = !!data.cachedMatrix && data.cachedMatrix.length > 0;
  const series = toSeries(data.cachedResult);
  const hasData = isMatrix ? hasMatrix || series.length > 0 : series.length > 0;
  const cv: ChartValue = {
    __chart: true, op, values: data.cachedResult, matrix: data.cachedMatrix,
    options: opts, title: opts.title || data.label || "Chart",
  };

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
        {!hasData ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : (
          <>
            <ChartFigure value={cv} width={W} height={H} />
            {/* The expand popup renders a single series — offer it only for the
                1-D ops (the matrix ops have no popup path). */}
            {!isMatrix && (
              <ChartExpandButton title={opts.title || data.label || "Chart"} op={op as ChartShape} axes series={series} opts={opts} />
            )}
          </>
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      {/* Series: wire a matrix for the composed/bubble ops. Options: a
          matplotlib-style string, or wire a Chart Builder (field hides when wired). */}
      <InlineInputs node={data} emit={emit} keys={["series", "options"]} />
    </NodeShell>
  );
}
