import { useState, useSyncExternalStore } from "react";
import type { GaugeNode as GaugeNodeType, GaugeStyle } from "../rete-nodes";
import { GAUGE_STYLE_OPTIONS } from "../rete-nodes";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { ScaleDial, GaugeArc, useChartColors } from "./chartView";
import { BulletBar } from "./chartCards";
import { dropInputCables } from "./cablePrune";

// Minified (square-collapse) dial — a tiny axis-less arc filling the square.
const MINI_SIZE = 46;
const MINI_SHOW = 24;

export function GaugeComponent({ data, emit }: NodeProps<GaugeNodeType>) {
  const [op, setOp] = useState<GaugeStyle>(data.op);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const { track } = useChartColors();
  const payload = data.cachedPayload;

  async function pickOp(next: GaugeStyle) {
    if (next === data.op) return;
    // onePrunePath: drop the departing bar-only cables BEFORE the socket removal.
    await dropInputCables(data.id, data.keysDropped(next));
    data.setOp(next);
    setOp(next);
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }

  const dial = op === "dial";
  const v = payload?.value;
  const frac = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const empty = <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

  return (
    // Collapse is square only for the dial; the bar keeps its width, so it isn't collapsible.
    <NodeShell node={data} emit={emit} {...(dial ? { squareCollapse: true } : { collapsible: false })}>
      <SegToggle value={op} options={GAUGE_STYLE_OPTIONS} onChange={(s) => void pickOp(s)} />
      <InlineInputs node={data} emit={emit} />
      {dial ? (
        <>
          {!collapsed && (payload ? <ScaleDial payload={payload} size={160} /> : empty)}
          <div className="solenoid-node__collapsed-only">
            {collapsed && payload && (
              <div style={{ position: "relative", width: MINI_SIZE, height: MINI_SHOW, overflow: "hidden" }}>
                <GaugeArc pct={frac * 100} track={track} size={MINI_SIZE} />
              </div>
            )}
          </div>
        </>
      ) : (
        payload ? <BulletBar payload={payload} /> : empty
      )}
    </NodeShell>
  );
}
