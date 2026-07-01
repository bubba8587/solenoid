import { RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
import type { GaugeNode as GaugeNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { formatScalar } from "./format";
import { useChartColors } from "./chartView";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";

const VIZ = "#e9b63a";
// recharts sizes a polar chart's radius off min(width, height)/2, so to get a
// wide arc (not a small one floating in deadspace) the chart must be SQUARE —
// then the radius is width-limited. We draw the full square and crop to the top
// half (the semicircle) with an overflow-hidden wrapper of height SHOW. SIZE fits
// the base 180px card's inner width.
const SIZE = 160;
const SHOW = 88;

export function GaugeComponent({ data, emit }: NodeProps<GaugeNodeType>) {
  const { track } = useChartColors();
  const value = data.cachedResult;
  // An upstream error makes the guard set cachedResult to a SolError (Gauge isn't
  // in SEES_ERRORS). Render the red #CODE! badge instead of letting it become a NaN
  // arc + "[object Object]" label.
  if (isSolError(value)) {
    return (
      <NodeShell node={data} emit={emit} collapsible={false}>
        <InlineInputs node={data} emit={emit} />
        <div className="solenoid-node__display-value solenoid-node__display-value--error" title={errorTip(value)}>{value.code}</div>
      </NodeShell>
    );
  }
  const min = data.literals.min ?? 0;
  const max = data.literals.max ?? 100;
  const span = max - min;
  const frac = value === null || span === 0 ? 0 : Math.min(1, Math.max(0, (value - min) / span));
  const pct = frac * 100;

  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <InlineInputs node={data} emit={emit} />
      <div style={{ position: "relative", width: SIZE, height: SHOW, margin: "2px auto 0", overflow: "hidden" }}>
        <RadialBarChart
          width={SIZE}
          height={SIZE}
          cx="50%"
          cy="50%"
          innerRadius="72%"
          outerRadius="94%"
          barSize={14}
          data={[{ value: pct }]}
          startAngle={180}
          endAngle={0}
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
          <RadialBar background={{ fill: track }} dataKey="value" cornerRadius={7} fill={VIZ} angleAxisId={0} isAnimationActive={false} />
        </RadialBarChart>
        <div style={{ position: "absolute", left: 0, right: 0, top: 50, textAlign: "center", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
          {value === null ? "—" : formatScalar(value)}
        </div>
        {/* Scale labels at the arc ends so the dial reads as a range, not a bare
            number — min at the left end (180°), max at the right end (0°). */}
        <div style={{ position: "absolute", left: 4, bottom: 0, fontSize: 9, color: "var(--text-dim)" }}>
          {formatScalar(min)}
        </div>
        <div style={{ position: "absolute", right: 4, bottom: 0, fontSize: 9, color: "var(--text-dim)" }}>
          {formatScalar(max)}
        </div>
      </div>
    </NodeShell>
  );
}
