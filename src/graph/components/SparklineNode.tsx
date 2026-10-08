import { useSyncExternalStore } from "react";
import type { SparklineNode as SparklineNodeType, SparklineOp } from "../rete-nodes";
import { SPARKLINE_OP_META } from "../rete-nodes";
import { NodeShell, PortSockets, useNodeField, type NodeProps } from "./nodeKit";
import { OpToggle } from "./SegToggle";
import { ChartView, toSeries, type ChartShape } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { appThemeStore } from "../appTheme";
import { collapseStore } from "../collapseStore";
import { resolveColor } from "../palette";
import { SPARK_SLOTS } from "../nodes/visualOps";

const OPTIONS: ReadonlyArray<{ value: SparklineOp; label: string }> = (Object.keys(SPARKLINE_OP_META) as SparklineOp[])
  .map((value) => ({ value, label: SPARKLINE_OP_META[value].label }));

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 56;

export function SparklineComponent({ data, emit }: NodeProps<SparklineNodeType>) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version); // re-resolve on palette/theme change
  // Mount only the visible figure of the live and minified pair: each is a full recharts tree, and animations are off, so the remount is instant.
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const [op, setOp] = useNodeField(data, "op");
  const rawSeries = toSeries(data.cachedResult);
  const chartOp: ChartShape = op === "winloss" ? "column" : op;
  const series = op === "winloss" ? rawSeries.map((s) => ({ ...s, v: Math.sign(s.v) })) : rawSeries;
  // The same three slots a SPARKLINE() picture paints in ([[D82]] sparklineCell).
  const signColors = op === "winloss"
    ? { pos: resolveColor(SPARK_SLOTS.pos), neg: resolveColor(SPARK_SLOTS.neg) }
    : undefined;
  const opts = { color: resolveColor(SPARK_SLOTS.line) };

  return (
    <NodeShell node={data} emit={emit} squareCollapse leading={<PortSockets node={data} emit={emit} side="input" />}>
      <OpToggle value={op} onChange={setOp} options={OPTIONS} />
      <div style={{ position: "relative", marginTop: 4, height: H }}>
        {series.length === 0 ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && (
          <>
            <ChartView op={chartOp} series={series} width={W} height={H} axes={false} opts={opts} signColors={signColors} />
            <ChartExpandButton title={data.label || "Sparkline"} op={chartOp} axes={false} series={series} opts={opts} signColors={signColors} />
          </>
        )}
      </div>
      <div className="solenoid-node__collapsed-only">
        {series.length === 0
          ? <span className="solenoid-node__display-value solenoid-node__display-value--empty">—</span>
          : collapsed && <ChartView op={chartOp} series={series} width={46} height={22} axes={false} opts={opts} signColors={signColors} />}
      </div>
    </NodeShell>
  );
}
