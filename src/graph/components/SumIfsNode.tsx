import { useState } from "react";
import type { SumIfsNode as SumIfsNodeType, CondAggOp } from "../rete-nodes";
import { COND_AGG_OP_META } from "../rete-nodes";
import type { FilterCondConfig } from "../frameVerbs";
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getActiveArea } from "../activeGraph";
import { useConnectedInputs, InlineInputs, InlineTextField } from "./inlineInput";
import { NodeShell, OpSelect, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { MeasuredSocketRow } from "./NodeSocket";
import { FILTER_OP_OPTIONS, TEXT_MATCH_OPS, VALUELESS_OPS } from "./FrameNodes";
import { stopDragStart } from "../coarse";
import { dropInputCables } from "./cablePrune";

const OPS = (Object.keys(COND_AGG_OP_META) as CondAggOp[]).map((op) => ({
  value: op,
  label: COND_AGG_OP_META[op].label,
}));

export function SumIfsComponent({ data, emit }: NodeProps<SumIfsNodeType>) {
  const connected = useConnectedInputs(data.id);
  const [op, setOp] = useNodeField(data, "op");
  const [match, setMatch] = useNodeField(data, "match");
  const [cfg, setCfg] = useState<Record<string, FilterCondConfig>>(() => ({ ...data.condConfig }));
  const strLiterals = (data.stringLiterals ??= {});
  const pairs = data.valuePairKeys();

  const rowCfg = (id: string): FilterCondConfig => cfg[id] ?? data.condConfig[id] ?? { op: "eq" };
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

  async function addPair() {
    data.addValuePair();
    await getActiveArea()?.rerenderNode(data.id);
    await processGraph();
  }

  async function removePair(colKey: string, valKey: string) {
    await dropInputCables(data.id, [colKey, valKey]);
    data.removeValuePair(colKey);
    await getActiveArea()?.rerenderNode(data.id);
    bumpConnectionVersion();
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["frame"]} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      {op !== "countifs" && (
        <MeasuredSocketRow side="input" socketKey="values" nodeId={data.id} emit={emit} payload={data.inputs.values!.socket}>
          <span className="solenoid-node__io-label">Values</span>
          {connected.has("values") ? (
            <span className="solenoid-node__io-wired" title="Driven by an incoming cable">↩ wired</span>
          ) : (
            <InlineTextField value={strLiterals.values} onChange={(v) => setStr("values", v)} />
          )}
        </MeasuredSocketRow>
      )}
      {pairs.map(([colKey, valKey], i) => {
        const id = colKey.slice(6);
        const c = rowCfg(id);
        return (
          <div key={colKey} className="solenoid-node__pair-group">
            <MeasuredSocketRow side="input" socketKey={colKey} nodeId={data.id} emit={emit} payload={data.inputs[colKey]!.socket}>
              <span className="solenoid-node__io-label">Column{pairs.length > 1 ? ` ${i + 1}` : ""}</span>
              {connected.has(colKey) ? (
                <span className="solenoid-node__io-wired" title="Driven by an incoming cable">↩ wired</span>
              ) : (
                <InlineTextField value={strLiterals[colKey]} onChange={(v) => setStr(colKey, v)} />
              )}
              {pairs.length > 1 && (
                <button
                  type="button"
                  className="solenoid-node__row-remove"
                  title="Remove this criterion"
                  onClick={(e) => { e.stopPropagation(); void removePair(colKey, valKey); }}
                >
                  ×
                </button>
              )}
            </MeasuredSocketRow>
            <ArgSelect value={c.op} options={FILTER_OP_OPTIONS} onChange={(next) => updateCfg(id, { op: next })} />
            <MeasuredSocketRow side="input" socketKey={valKey} nodeId={data.id} emit={emit} payload={data.inputs[valKey]!.socket}>
              <span className="solenoid-node__io-label">Value</span>
              {connected.has(valKey) ? (
                <span className="solenoid-node__io-wired" title={VALUELESS_OPS.has(c.op) ? "Ignored by this condition" : "Driven by an incoming cable"}>↩ wired</span>
              ) : !VALUELESS_OPS.has(c.op) ? (
                <InlineTextField value={strLiterals[valKey]} onChange={(v) => setStr(valKey, v)} />
              ) : null}
              {TEXT_MATCH_OPS.has(c.op) && (
                <button
                  type="button"
                  title="Match case. Off matches text like Excel's = does."
                  aria-pressed={c.matchCase ?? false}
                  onClick={(e) => { e.stopPropagation(); updateCfg(id, { matchCase: !c.matchCase }); }}
                  onPointerDown={stopDragStart}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    flexShrink: 0, fontSize: 11, lineHeight: 1, padding: "3px 5px",
                    border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer",
                    background: c.matchCase ? "var(--accent)" : "transparent",
                    color: c.matchCase ? "var(--surface)" : "var(--text-muted)",
                  }}
                >
                  Aa
                </button>
              )}
            </MeasuredSocketRow>
          </div>
        );
      })}
      {/* With one criterion All and Any are the same, so the toggle only earns its row past that. */}
      {pairs.length > 1 && (
        <SegToggle
          value={match}
          options={[{ value: "all", label: "Match all" }, { value: "any", label: "Match any" }]}
          onChange={setMatch}
        />
      )}
      <button
        type="button"
        className="solenoid-node__add-input"
        onClick={(e) => { e.stopPropagation(); void addPair(); }}
      >
        + Add criterion
      </button>
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
