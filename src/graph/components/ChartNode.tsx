// [[C100]] chartIsAValue, [[C8]] declareOnce
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

async function applyChartOp(node: ChartNodeType, newOp: ChartOp): Promise<void> {
  node.op = newOp;
  await processGraph();
}

const CHART_OPS = Object.keys(CHART_OP_META) as ChartOp[];
const FAMILIES = [...new Set(CHART_OPS.map((op) => CHART_OP_META[op].group))];
const OPS_BY_FAMILY: Record<string, ChartOp[]> = Object.fromEntries(
  FAMILIES.map((f) => [f, CHART_OPS.filter((op) => CHART_OP_META[op].group === f)]),
);
const FAMILY_OPTS: ReadonlyArray<OpOption<string>> = FAMILIES.map((value) => ({ value, label: value }));

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
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const fontScale = formatAnnotationStore.getForNode(data.id)?.chartFontScale;
  const noExpand = op === "composed" || op === "bubble";
  const series = toSeries(data.cachedResult);
  const hasData = series.length > 0 || !!data.cachedSeries;
  const cv: ChartValue = {
    __chart: true, op, values: data.cachedResult,
    series: data.cachedSeries ?? undefined,
    labels: data.cachedLabels ?? undefined,
    options: opts, title: opts.title || nodeDisplayName(data),
  };

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
      {/* The type is the node's `op`, so it stays the accented OpSelect; the family only filters it (opArgDistinct). */}
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
      {/* Collapsed, the leading `values` socket is gone, so it folds into this row. */}
      <InlineInputs
        node={data}
        emit={emit}
        keys={collapsed ? ["values", "options"] : ["options"]}
      />
      {/* Collapsed, the hero box shows only the Chart chip. */}
      <div className="solenoid-node__collapsed-only solenoid-node__display-value solenoid-node__display-value--chip"><ChartChip value={cv} /></div>
    </NodeShell>
  );
}
