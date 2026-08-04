import { useSyncExternalStore } from "react";
import type { GaugeNode as GaugeNodeType } from "../rete-nodes";
import { collapseStore } from "../collapseStore";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useChartColors, GaugeArc } from "./chartView";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";

// recharts sizes a polar radius off min(width, height)/2, so the chart must be
// SQUARE and cropped to its top half for the arc to come out wide.
const SIZE = 160;
const SHOW = 88;
// Minified (square-collapse) dial — a tiny axis-less arc filling the square.
const MINI_SIZE = 46;
const MINI_SHOW = 24;

// The value is read as a fraction of 100% (1 → 100%, 1.5 → 150%).
function formatPct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}

export function GaugeComponent({ data, emit }: NodeProps<GaugeNodeType>) {
  const { track } = useChartColors();
  // Only the VISIBLE dial is mounted — each GaugeArc is a full recharts tree.
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const value = data.cachedResult;
  // Gauge isn't in SEES_ERRORS, so an upstream error lands in cachedResult — badge
  // it rather than letting it render as a NaN arc.
  if (isSolError(value)) {
    return (
      <NodeShell node={data} emit={emit} collapsible={false}>
        <InlineInputs node={data} emit={emit} />
        <div
          className={`solenoid-node__display-value solenoid-node__display-value--error${value.origin ? " sol-error-chip--clickable" : ""}`}
          title={errorTip(value)}
          onClick={value.origin ? () => flyToNode(value.origin!.nodeId) : undefined}
          onPointerDown={value.origin ? (e) => e.stopPropagation() : undefined}
          onMouseDown={value.origin ? (e) => e.stopPropagation() : undefined}
        >{value.code}</div>
      </NodeShell>
    );
  }
  // A non-finite value reads as "no value" — an empty dial and an em-dash label.
  const v = typeof value === "number" && Number.isFinite(value) ? value : null;
  // The dial always spans 0→100%: the arc clamps, the label keeps the true value.
  const frac = v === null ? 0 : Math.min(1, Math.max(0, v));
  const pct = frac * 100;

  return (
    <NodeShell node={data} emit={emit} squareCollapse>
      <InlineInputs node={data} emit={emit} />
      <div style={{ position: "relative", width: SIZE, height: SHOW, margin: "2px auto 0", overflow: "hidden" }}>
        {!collapsed && <GaugeArc pct={pct} track={track} size={SIZE} />}
        <div style={{ position: "absolute", left: 0, right: 0, top: 50, textAlign: "center", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
          {v === null ? "—" : formatPct(v)}
        </div>
        <div style={{ position: "absolute", left: 4, bottom: 0, fontSize: 9, color: "var(--text-dim)" }}>0%</div>
        <div style={{ position: "absolute", right: 4, bottom: 0, fontSize: 9, color: "var(--text-dim)" }}>100%</div>
      </div>
      <div className="solenoid-node__collapsed-only">
        {v === null
          ? <span className="solenoid-node__display-value solenoid-node__display-value--empty">—</span>
          : collapsed && <div style={{ position: "relative", width: MINI_SIZE, height: MINI_SHOW, overflow: "hidden" }}>
              <GaugeArc pct={pct} track={track} size={MINI_SIZE} />
            </div>}
      </div>
    </NodeShell>
  );
}
