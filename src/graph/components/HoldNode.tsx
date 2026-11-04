// [[C23]] calcModes
import { useEffect, useState } from "react";
import type { HoldNode as HoldNodeType } from "../nodeClasses";
import { processGraph } from "../process";
import { NodeShell, InlineOutputRows, type NodeProps, type OutputRowValue } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { SegToggle } from "./SegToggle";
import { SwitchValue } from "./CableSwitchNode";
import { nodeDisplayName } from "../catalogUtils";
import "./HoldNode.css";

export function HoldComponent({ data, emit }: NodeProps<HoldNodeType>) {
  const [mode, setMode] = useState(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  const [refused, setRefused] = useState(false);

  function capture() {
    const ok = data.capture(data.cachedLive);
    setRefused(!ok);
    if (!ok) return;
    setMode(data.mode);
    data.edited(); void processGraph();
  }
  function release() {
    data.release();
    setRefused(false);
    setMode(data.mode);
    data.edited(); void processGraph();
  }

  const out = data.outputs.out;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="sol-hold__bar">
        <SegToggle
          value={mode}
          options={[
            { value: "live", label: "Live", title: "Pass the value on as it changes" },
            { value: "held", label: "Held", title: "Keep the value as it is now" },
          ]}
          onChange={(v) => (v === "held" ? capture() : release())}
          className="sol-hold__mode"
        />
        {mode === "held" && (
          <button
            type="button" className="sol-hold__recapture" title="Hold the value as it is now"
            onClick={(e) => { e.stopPropagation(); capture(); }}
            onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          >Recapture</button>
        )}
      </div>
      {refused && <div className="sol-hold__note">this value can't be saved, so it can't be held</div>}
      {out && (
        <MeasuredSocketRow side="output" socketKey="out" nodeId={data.id} emit={emit} payload={out.socket} hero>
          <SwitchValue value={data.cachedValue} label={nodeDisplayName(data)} nodeId={data.id} />
        </MeasuredSocketRow>
      )}
      <InlineOutputRows node={data} emit={emit} rows={[{ key: "changed", label: "CHANGED", value: data.cachedChanged as OutputRowValue }]} />
    </NodeShell>
  );
}
