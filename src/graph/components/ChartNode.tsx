import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChartNode as ChartNodeType, ChartOp } from "../rete-nodes";
import { CHART_MATRIX_OPS, CHART_OP_META } from "../rete-nodes";
import { NodeShell, OpSelect, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { ChartFigure, toSeries, type ChartShape } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { formatAnnotationStore } from "../formatAnnotationStore";
import type { ChartValue } from "../chartValue";
import { dropInputCables } from "./cablePrune";

// Both data ports stay defined but only the op's active one renders, so an op-FAMILY
// switch (1-D ↔ matrix) must drop the inactive socket's cable — else it lives invisibly.
async function applyChartOp(node: ChartNodeType, newOp: ChartOp): Promise<void> {
  const wasMatrix = CHART_MATRIX_OPS.has(node.op);
  const nowMatrix = CHART_MATRIX_OPS.has(newOp);
  node.op = newOp;
  if (wasMatrix !== nowMatrix) {
    const inactive = nowMatrix ? "values" : "series";
    await dropInputCables(node.id, [inactive]);
    const area = getActiveArea();
    if (area) await area.update("node", node.id);
  }
  await processGraph();
}

// Derived from CHART_OP_META so the dropdown can't drift from the Add-menu rows (SSOT-1).
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
  const isMatrix = CHART_MATRIX_OPS.has(op);
  const hasMatrix = !!data.cachedMatrix && data.cachedMatrix.length > 0;
  const series = toSeries(data.cachedResult);
  const hasData = isMatrix ? hasMatrix || series.length > 0 : series.length > 0;
  const cv: ChartValue = {
    __chart: true, op, values: data.cachedResult, matrix: data.cachedMatrix,
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
      leading={!collapsed && !isMatrix && valuesPort && valuesTop !== undefined
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
            {/* The expand popup renders a single series — offer it only for the
                1-D ops (the matrix ops have no popup path). */}
            {!isMatrix && (
              <ChartExpandButton title={opts.title || data.label || "Chart"} op={op as ChartShape} axes series={series} opts={opts} labels={data.cachedLabels ?? undefined} />
            )}
          </>
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      {/* The op's data socket + Options. `series` (2-D matrix) shows only for the
          composed/bubble ops; the 1-D ops feed the leading `values` socket instead.
          Collapsed, the leading socket is gone, so fold `values` into this row's pill.
          Options: a matplotlib-style string, or wire a Chart Builder (field hides
          when wired). */}
      <InlineInputs
        node={data}
        emit={emit}
        keys={collapsed ? (isMatrix ? ["series", "options"] : ["values", "options"]) : (isMatrix ? ["series", "options"] : ["options"])}
      />
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup),
          right-aligned like every other value chip. */}
      <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={cv} /></div>
    </NodeShell>
  );
}
