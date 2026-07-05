import type { SparklineNode as SparklineNodeType, SparklineOp } from "../rete-nodes";
import { NodeShell, PortSockets, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { ChartView, toSeries, type ChartShape } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";

const OPTIONS: ReadonlyArray<{ value: SparklineOp; label: string }> = [
  { value: "line",    label: "Line" },
  { value: "column",  label: "Column" },
  { value: "winloss", label: "Win/Loss" },
];

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 56;

export function SparklineComponent({ data, emit }: NodeProps<SparklineNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const rawSeries = toSeries(data.cachedResult);
  // Win/Loss draws as a column chart of the signs (+1 up / −1 down / 0 flat).
  const chartOp: ChartShape = op === "winloss" ? "column" : op;
  const series = op === "winloss" ? rawSeries.map((s) => ({ ...s, v: Math.sign(s.v) })) : rawSeries;

  return (
    <NodeShell node={data} emit={emit} squareCollapse leading={<PortSockets node={data} emit={emit} side="input" />}>
      <SegToggle value={op} onChange={setOp} options={OPTIONS} />
      <div style={{ position: "relative", marginTop: 4, height: H }}>
        {series.length === 0 ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : (
          <>
            <ChartView op={chartOp} series={series} width={W} height={H} axes={false} />
            <ChartExpandButton title={data.label || "Sparkline"} op={chartOp} axes={false} series={series} />
          </>
        )}
      </div>
      {/* Minified (square) readout: a tiny axis-less spark filling the square;
          double-click the square to expand (the chevron is hidden — see NodeCard). */}
      <div className="solenoid-node__collapsed-only">
        {series.length === 0
          ? <span className="solenoid-node__display-value solenoid-node__display-value--empty">—</span>
          : <ChartView op={chartOp} series={series} width={44} height={28} axes={false} />}
      </div>
    </NodeShell>
  );
}
