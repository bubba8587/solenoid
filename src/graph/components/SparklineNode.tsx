import { useSyncExternalStore } from "react";
import type { SparklineNode as SparklineNodeType, SparklineOp } from "../rete-nodes";
import { SPARKLINE_OP_META } from "../rete-nodes";
import { NodeShell, PortSockets, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { ChartView, toSeries, type ChartShape } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { appThemeStore } from "../appTheme";
import { collapseStore } from "../collapseStore";
import { resolveColor } from "../palette";

// Derived from SPARKLINE_OP_META (SSOT-1) — the table the search rows read too.
const OPTIONS: ReadonlyArray<{ value: SparklineOp; label: string }> = (Object.keys(SPARKLINE_OP_META) as SparklineOp[])
  .map((value) => ({ value, label: SPARKLINE_OP_META[value].label }));

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 56;

export function SparklineComponent({ data, emit }: NodeProps<SparklineNodeType>) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version); // re-resolve on palette/theme change
  // Exactly one of the two figures (live / minified) is visible at a time (CSS,
  // .solenoid-node__collapsed-only) — mount only that one instead of both, since
  // each is a full recharts tree (~dozens of SVG elements). Animations are off
  // globally (isAnimationActive={false}), so the remount on toggle is instant.
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const [op, setOp] = useNodeField(data, "op");
  const rawSeries = toSeries(data.cachedResult);
  // Win/Loss draws as a column chart of the signs (+1 up / −1 down / 0 flat),
  // colored up = palette green, down = the palette error red (vermilion).
  const chartOp: ChartShape = op === "winloss" ? "column" : op;
  const series = op === "winloss" ? rawSeries.map((s) => ({ ...s, v: Math.sign(s.v) })) : rawSeries;
  const signColors = op === "winloss"
    ? { pos: resolveColor("green"), neg: resolveColor("vermilion") }
    : undefined;

  return (
    <NodeShell node={data} emit={emit} squareCollapse leading={<PortSockets node={data} emit={emit} side="input" />}>
      <SegToggle value={op} onChange={setOp} options={OPTIONS} />
      <div style={{ position: "relative", marginTop: 4, height: H }}>
        {series.length === 0 ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && (
          <>
            <ChartView op={chartOp} series={series} width={W} height={H} axes={false} signColors={signColors} />
            <ChartExpandButton title={data.label || "Sparkline"} op={chartOp} axes={false} series={series} signColors={signColors} />
          </>
        )}
      </div>
      {/* Minified (square) readout: a tiny axis-less spark filling the square;
          double-click the square to expand (the chevron is hidden — see NodeCard). */}
      <div className="solenoid-node__collapsed-only">
        {series.length === 0
          ? <span className="solenoid-node__display-value solenoid-node__display-value--empty">—</span>
          : collapsed && <ChartView op={chartOp} series={series} width={46} height={22} axes={false} signColors={signColors} />}
      </div>
    </NodeShell>
  );
}
