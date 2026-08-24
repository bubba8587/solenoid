import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChartNode as ChartNodeType, ChartOp } from "../rete-nodes";
import { CHART_OP_META } from "../rete-nodes";
import { NodeShell, OpSelect, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { ChartFigure, toSeries, type ChartShape } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { formatAnnotationStore } from "../formatAnnotationStore";
import type { ChartValue } from "../chartValue";

// Every op reads the one `values` frame now, so switching op is a plain recompute.
async function applyChartOp(node: ChartNodeType, newOp: ChartOp): Promise<void> {
  node.op = newOp;
  await processGraph();
}

// Derived from CHART_OP_META so the dropdown can't drift from the Add-menu rows (declareOnce).
const OPTIONS: ReadonlyArray<OpOption<ChartOp>> = (Object.keys(CHART_OP_META) as ChartOp[])
  .map((value) => ({ value, label: CHART_OP_META[value].label, group: CHART_OP_META[value].group }));

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 150;

export function ChartComponent({ data, emit }: NodeProps<ChartNodeType>) {
  const [op, setOpState] = useState<ChartOp>(data.op);
  const setOp = useCallback((v: ChartOp) => { setOpState(v); void applyChartOp(data, v); }, [data]);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const opts = data.chartOptions;
  // An FC on the chart output scales the figure's text (display only).
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const fontScale = formatAnnotationStore.getForNode(data.id)?.chartFontScale;
  // The expand popup renders a single series; composed/bubble use the [Chart] chip instead.
  const noExpand = op === "composed" || op === "bubble";
  const series = toSeries(data.cachedResult);
  const hasData = series.length > 0 || !!data.cachedSeries;
  const cv: ChartValue = {
    __chart: true, op, values: data.cachedResult,
    series: data.cachedSeries ?? undefined,
    labels: data.cachedLabels ?? undefined,
    options: opts, title: opts.title || data.label || "Chart",
  };

  // The data socket is measured against the card so it can't collide with the Options row.
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
      leading={!collapsed && valuesPort && valuesTop !== undefined
        ? <NodeSocket side="input" socketKey="values" nodeId={data.id} emit={emit} payload={valuesPort.socket} top={valuesTop} />
        : null}
    >
      <OpSelect value={op} onChange={setOp} options={OPTIONS} />
      <div ref={chartRef} className="solenoid-node__figure" style={{ position: "relative", marginTop: 4, height: H }}>
        {!hasData ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && (
          <>
            <ChartFigure value={cv} width={W} height={H} fontScale={fontScale} />
            {!noExpand && (
              <ChartExpandButton title={opts.title || data.label || "Chart"} op={op as ChartShape} axes series={series} opts={opts} labels={data.cachedLabels ?? undefined} value={cv} />
            )}
          </>
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      {/* Every op reads the `values` frame via the leading socket; collapsed, that socket
          is gone, so fold `values` into this row. Options: a matplotlib-style string, or
          wire a Chart Builder (the field hides when wired). */}
      <InlineInputs
        node={data}
        emit={emit}
        keys={collapsed ? ["values", "options"] : ["options"]}
      />
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup),
          right-aligned like every other value chip. */}
      <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={cv} /></div>
    </NodeShell>
  );
}
