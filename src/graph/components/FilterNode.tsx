// [[D10]] onePrunePath
import { useState } from "react";
import type { FilterNode as FilterNodeType } from "../rete-nodes";
import type { FilterCondConfig } from "../frameVerbs";
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getActiveView } from "../activeGraph";
import { useConnectedInputs, InlineInputs, InlineTextField } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { MeasuredSocketRow } from "./NodeSocket";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { ArrayChip } from "./ArrayChip";
import { FILTER_OP_OPTIONS_WITH_ERROR, TEXT_MATCH_OPS, VALUELESS_OPS, FILTER_COMBINE_OPTIONS, MatchCaseButton } from "./FrameNodes";
import type { DisplayValue } from "./valueDisplayFormat";
import { dropInputCables } from "./cablePrune";
import { nodeDisplayName } from "../catalogUtils";

// The frame Filter's condition rows minus the column picker — a list has no lanes, so a
// row is just op + value. Kept rides the hero box; Dropped is the complement.
export function FilterComponent({ data, emit }: NodeProps<FilterNodeType>) {
  const connected = useConnectedInputs(data.id);
  const [combine, setCombine] = useNodeField(data, "combine");
  const [cfg, setCfg] = useState<Record<string, FilterCondConfig>>(() => ({ ...data.condConfig }));
  const strLiterals = (data.stringLiterals ??= {});
  const keys = data.valueInputKeys();

  const rowCfg = (id: string): FilterCondConfig => cfg[id] ?? data.condConfig[id] ?? { op: "gt" };
  const updateCfg = (id: string, patch: Partial<FilterCondConfig>) => {
    const next = { ...rowCfg(id), ...patch };
    setCfg((c) => ({ ...c, [id]: next }));
    data.condConfig[id] = next;
    void processGraph();
  };
  const setStr = (key: string, v: string) => {
    strLiterals[key] = v;
    void processGraph();
  };

  async function addRow() {
    data.addValueInput();
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }

  async function removeRow(key: string) {
    await dropInputCables(data.id, [key]);
    data.removeValueInput(key);
    await getActiveView()?.rerenderNode(data.id);
    bumpConnectionVersion();
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} keys={["list"]} />
      {keys.length > 1 && (
        <SegToggle value={combine} options={FILTER_COMBINE_OPTIONS} onChange={setCombine} />
      )}
      {keys.map((key, i) => {
        const id = key.slice(5);
        const c = rowCfg(id);
        return (
          <div key={key} className="solenoid-node__pair-group">
            <ArgSelect value={c.op} options={FILTER_OP_OPTIONS_WITH_ERROR} onChange={(op) => updateCfg(id, { op })} />
            <MeasuredSocketRow side="input" socketKey={key} nodeId={data.id} emit={emit} payload={data.inputs[key]!.socket}>
              <span className="solenoid-node__io-label">Value{keys.length > 1 ? ` ${i + 1}` : ""}</span>
              {connected.has(key) ? (
                <span className="solenoid-node__io-wired" title={VALUELESS_OPS.has(c.op) ? "Ignored by this condition" : "Driven by an incoming cable"}>↩ wired</span>
              ) : !VALUELESS_OPS.has(c.op) ? (
                <InlineTextField value={strLiterals[key]} onChange={(v) => setStr(key, v)} />
              ) : null}
              {TEXT_MATCH_OPS.has(c.op) && (
                <MatchCaseButton on={c.matchCase ?? false} onToggle={() => updateCfg(id, { matchCase: !c.matchCase })} />
              )}
              {keys.length > 1 && (
                <button
                  type="button"
                  className="solenoid-node__row-remove"
                  title="Remove this condition"
                  onClick={(e) => { e.stopPropagation(); void removeRow(key); }}
                >
                  ×
                </button>
              )}
            </MeasuredSocketRow>
          </div>
        );
      })}
      <button
        type="button"
        className="solenoid-node__add-input"
        onClick={(e) => { e.stopPropagation(); void addRow(); }}
      >
        Add Condition
      </button>
      <MeasuredSocketRow side="output" socketKey="result" nodeId={data.id} emit={emit} payload={data.outputs.result!.socket} hero>
        <ValueDisplay value={data.cachedResult as DisplayValue} />
      </MeasuredSocketRow>
      <MeasuredSocketRow side="output" socketKey="dropped" nodeId={data.id} emit={emit} payload={data.outputs.dropped!.socket}>
        <span className="solenoid-node__io-label">Dropped</span>
        <span className="solenoid-node__output-value" style={{ display: "flex", justifyContent: "flex-end" }}>
          {Array.isArray(data.cachedDropped) && data.cachedDropped.length > 0
            ? <ArrayChip value={data.cachedDropped as (number | string | null)[]} label={`${nodeDisplayName(data)}: Dropped`} size="sm" elem={nodeOutputElemFamily(data.id, "dropped")} />
            : "—"}
        </span>
      </MeasuredSocketRow>
    </NodeShell>
  );
}
