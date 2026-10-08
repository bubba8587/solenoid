import { useSyncExternalStore } from "react";
import type { EarnedValueNode as EarnedValueNodeType } from "../rete-nodes";
import { NodeShell, InlineOutputRows, type NodeProps, type OutputRowValue } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { FrameDisplay } from "./FrameDisplay";
import { MeasuredSocketRow } from "./NodeSocket";
import { nodeDisplayName } from "../catalogUtils";
import { isSolError } from "../errorValue";
import { isUnitCell } from "../unitValue";
import { displayMagnitudeOf } from "../unitBridge";
import { CardSection, useRowsInUse } from "./CardSection";
import { EARNED_VALUE_DEFAULT_LITERALS } from "../nodes/earnedValue";
import { collapseStore } from "../collapseStore";

// A ratio reads to two places; an index of 1.0 is on plan. Blank when undefined (a 0 denominator).
function ratioText(v: OutputRowValue): OutputRowValue {
  if (isSolError(v) || v == null) return v as OutputRowValue;
  return typeof v === "number" ? v.toFixed(2) : v;
}
function moneyText(v: OutputRowValue): OutputRowValue {
  if (isSolError(v) || v == null) return v as OutputRowValue;
  const n = isUnitCell(v) ? displayMagnitudeOf(v) : v;
  return typeof n === "number" ? Math.round(n).toLocaleString() : v;
}

const CALENDAR_KEYS = ["holidays", "weekend_code"];

export function EarnedValueComponent({ data, emit }: NodeProps<EarnedValueNodeType>) {
  const frameOut = data.outputs.frame;
  const calendar = useRowsInUse(data, CALENDAR_KEYS, EARNED_VALUE_DEFAULT_LITERALS);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} keys={collapsed ? undefined : ["schedule", "baseline", "status", "cost"]} />
      {!collapsed && (
        <CardSection label="Calendar" collapsible defaultOpen={calendar} sockets={{ node: data, emit, keys: CALENDAR_KEYS }}>
          <InlineInputs node={data} emit={emit} keys={CALENDAR_KEYS} />
        </CardSection>
      )}
      {frameOut && (
        <MeasuredSocketRow hero side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={frameOut.socket}>
          <div style={{ width: "100%" }}>
            <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
          </div>
        </MeasuredSocketRow>
      )}
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "spi", label: "SPI", value: ratioText(data.cachedSpi as OutputRowValue) },
          { key: "cpi", label: "CPI", value: ratioText(data.cachedCpi as OutputRowValue) },
          { key: "eac", label: "EAC", value: moneyText(data.cachedEac as OutputRowValue) },
        ]}
      />
    </NodeShell>
  );
}
