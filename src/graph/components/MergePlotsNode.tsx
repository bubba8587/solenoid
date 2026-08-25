import { useSyncExternalStore } from "react";
import type { MergePlotsNode as MergePlotsNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { ErrorChip } from "./ErrorChip";
import { collapseStore } from "../collapseStore";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { isChartValue, type ChartValue } from "../chartValue";
import type { SolError } from "../errorValue";
import { nodeDisplayName } from "../catalogUtils";

// Fills the wide card (240) minus body padding, matching Chart.
const W = 218;
const H = 150;

export function MergePlotsComponent({ data, emit }: NodeProps<MergePlotsNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  // An FC on the chart output scales the figure's text (display only).
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const fontScale = formatAnnotationStore.getForNode(data.id)?.chartFontScale;

  const cached = data.cachedChart;
  // A non-plot input refuses the merge; cachedChart then holds the #TYPE! error.
  const err: SolError | null = cached && !isChartValue(cached) ? cached : null;
  const overlay = cached && isChartValue(cached) ? cached : null;
  const hasData = !!overlay && overlay.payload?.kind === "overlay" && overlay.payload.series.length > 0;
  // The live card title tracks the node's name; the cable value keeps its own.
  const cv: ChartValue | null = overlay ? { ...overlay, title: overlay.options.title || nodeDisplayName(data) } : null;

  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} valueKeys={data.plotKeys()} addLabel="+ Add plot" />
      <div className="solenoid-node__figure" style={{ position: "relative", marginTop: 4, height: H }}>
        {err ? (
          <div className="solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ErrorChip err={err} /></div>
        ) : !hasData ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && cv ? (
          <ChartFigure value={cv} width={W} height={H} fontScale={fontScale} />
        ) : null}
      </div>
      <div className="solenoid-node__section-divider" />
      {/* Options: a matplotlib-style string, or wire a Chart Builder (the field hides when wired). */}
      <InlineInputs node={data} emit={emit} keys={["options"]} />
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup). */}
      {cv && <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={cv} /></div>}
    </NodeShell>
  );
}
