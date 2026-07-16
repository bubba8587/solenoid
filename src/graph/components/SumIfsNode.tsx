import { useState } from "react";
import type { SumIfsNode as SumIfsNodeType, CondAggOp } from "../rete-nodes";
import { COND_AGG_OP_META } from "../rete-nodes";
import type { FilterCondConfig } from "../frameVerbs";
import { processGraph, bumpConnectionVersion } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { useConnectedInputs, InlineInputs, InlineTextField } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { pushRowAddUndo, pushRowRemovalUndo } from "./ExtensibleInputs";
import { FILTER_OP_OPTIONS, TEXT_MATCH_OPS, VALUELESS_OPS } from "./FrameNodes";

const OPS = (Object.keys(COND_AGG_OP_META) as CondAggOp[]).map((op) => ({
  value: op,
  label: COND_AGG_OP_META[op].label,
}));

// Excel's SUMIFS mental model over ONE FRAME (D16, amended): pick the op, name
// the Values column, and add criteria rows (column + op + value, AND-combined
// like the *IFS family). The frame Filter's condition-row UI plus an aggregate.
export function SumIfsComponent({ data, emit }: NodeProps<SumIfsNodeType>) {
  const connected = useConnectedInputs(data.id);
  const [op, setOp] = useNodeField(data, "op");
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
    const before = new Set(Object.keys(data.inputs));
    data.addValuePair();
    const added = Object.keys(data.inputs).filter((k) => !before.has(k));
    const colKey = added[0];
    if (colKey) pushRowAddUndo(data, added, () => data.removeValuePair(colKey));
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }

  async function removePair(colKey: string, valKey: string) {
    const editor = getActiveEditor();
    if (editor) {
      for (const c of editor.getConnections()) {
        if (c.target === data.id && (c.targetInput === colKey || c.targetInput === valKey)) {
          await editor.removeConnection(c.id);
        }
      }
    }
    pushRowRemovalUndo(data, [colKey, valKey], () => data.removeValuePair(colKey));
    data.removeValuePair(colKey);
    await getActiveArea()?.update("node", data.id);
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
            <OpSelect value={c.op} options={FILTER_OP_OPTIONS} onChange={(next) => updateCfg(id, { op: next })} />
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
                  onPointerDown={(e) => e.stopPropagation()}
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
