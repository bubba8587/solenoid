import { useState, useSyncExternalStore } from "react";
import type { GaugeNode as GaugeNodeType, GaugeStyle } from "../rete-nodes";
import { GAUGE_STYLE_OPTIONS } from "../rete-nodes";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getActiveView } from "../activeGraph";
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
  const [mode, setMode] = useState<GaugeStyle>(data.mode);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const { track } = useChartColors();
  const payload = data.cachedPayload;

  async function pickMode(next: GaugeStyle) {
    if (next === data.mode) return;
    // onePrunePath: drop the departing bar-only cables BEFORE the socket removal.
    await dropInputCables(data.id, data.keysDropped(next));
    data.setMode(next);
    setMode(next);
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }

  const dial = mode === "dial";
  const v = payload?.value;
  const frac = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const empty = <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

  return (
    // Dial square-collapses to a mini arc; the bar keeps its width and collapses
    // normally — the standard chevron, like every other node.
    <NodeShell node={data} emit={emit} {...(dial ? { squareCollapse: true } : {})}>
      <SegToggle value={mode} options={GAUGE_STYLE_OPTIONS} onChange={(s) => void pickMode(s)} />
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
        !collapsed && (payload ? <BulletBar payload={payload} /> : empty)
      )}
    </NodeShell>
  );
}
