import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChartNode as ChartNodeType, ChartOp } from "../rete-nodes";
import { CHART_OP_META } from "../rete-nodes";
import { NodeShell, OpSelect, ArgSelect, type NodeProps, type OpOption } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs } from "./inlineInput";
import { ChartFigure, toSeries, type ChartShape } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { formatAnnotationStore } from "../formatAnnotationStore";
import type { ChartValue } from "../chartValue";
import { nodeDisplayName } from "../catalogUtils";

// Every op reads the one `values` frame now, so switching op is a plain recompute.
async function applyChartOp(node: ChartNodeType, newOp: ChartOp): Promise<void> {
  node.op = newOp;
  await processGraph();
}

// A two-level pick: the FAMILY (Cartesian / Categorical / Multi-series) is the primary
// op-select, and a neutral second select refines it to a specific type. Both derive from
// CHART_OP_META so they can't drift from the Add-menu rows (declareOnce). Picking a family
// jumps to its first type.
const CHART_OPS = Object.keys(CHART_OP_META) as ChartOp[];
const FAMILIES = [...new Set(CHART_OPS.map((op) => CHART_OP_META[op].group))];
const OPS_BY_FAMILY: Record<string, ChartOp[]> = Object.fromEntries(
  FAMILIES.map((f) => [f, CHART_OPS.filter((op) => CHART_OP_META[op].group === f)]),
);
const FAMILY_OPTS: ReadonlyArray<OpOption<string>> = FAMILIES.map((value) => ({ value, label: value }));

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 150;

export function ChartComponent({ data, emit }: NodeProps<ChartNodeType>) {
  const [op, setOpState] = useState<ChartOp>(data.op);
  const setOp = useCallback((v: ChartOp) => { setOpState(v); void applyChartOp(data, v); }, [data]);
  const family = CHART_OP_META[op].group;
  const setFamily = useCallback((f: string) => { setOp(OPS_BY_FAMILY[f][0]); }, [setOp]);
  const typeOpts: ReadonlyArray<OpOption<ChartOp>> = OPS_BY_FAMILY[family]
    .map((value) => ({ value, label: CHART_OP_META[value].label }));
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
    options: opts, title: opts.title || nodeDisplayName(data),
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
      {/* The chart TYPE is the node's `op`, so it stays the accented OpSelect; the family is
          a filter that narrows the type list to one group (sourceInvariants opArgDistinct). */}
      <div className="solenoid-node__field-row">
        <ArgSelect value={family} onChange={setFamily} options={FAMILY_OPTS} />
        <OpSelect value={op} onChange={setOp} options={typeOpts} />
      </div>
      <div ref={chartRef} className="solenoid-node__figure" style={{ position: "relative", marginTop: 4, height: H }}>
        {!hasData ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && (
          <>
            <ChartFigure value={cv} width={W} height={H} fontScale={fontScale} />
            {!noExpand && (
              <ChartExpandButton title={opts.title || nodeDisplayName(data)} op={op as ChartShape} axes series={series} opts={opts} labels={data.cachedLabels ?? undefined} value={cv} />
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
