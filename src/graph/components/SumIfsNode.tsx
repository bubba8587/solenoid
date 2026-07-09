import { useState } from "react";
import type { SumIfsNode as SumIfsNodeType, CondAggOp } from "../rete-nodes";
import { COND_AGG_OP_META } from "../rete-nodes";
import type { FilterCondConfig } from "../frameVerbs";
import { processGraph, bumpConnectionVersion } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { useConnectedInputs, useIncomingSources, InlineTextField } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { pushRowAddUndo, pushRowRemovalUndo } from "./ExtensibleInputs";
import { FILTER_OP_OPTIONS, TEXT_MATCH_OPS } from "./FrameNodes";

const OPS = (Object.keys(COND_AGG_OP_META) as CondAggOp[]).map((op) => ({
  value: op,
  label: COND_AGG_OP_META[op].label,
}));

// Excel's SUMIFS mental model as one card: a Values list plus extensible
// criteria PAIRS (a wired criteria list + op + value), AND-combined like the
// *IFS family. The task-shaped home of the parallel-list pattern (D16).
export function SumIfsComponent({ data, emit }: NodeProps<SumIfsNodeType>) {
  const connected = useConnectedInputs(data.id);
  const incoming = useIncomingSources(data.id);
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
    const critKey = added[0];
    if (critKey) pushRowAddUndo(data, added, () => data.removeValuePair(critKey));
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }

  async function removePair(critKey: string, cvalKey: string) {
    const editor = getActiveEditor();
    if (editor) {
      for (const c of editor.getConnections()) {
        if (c.target === data.id && (c.targetInput === critKey || c.targetInput === cvalKey)) {
          await editor.removeConnection(c.id);
        }
      }
    }
    pushRowRemovalUndo(data, [critKey, cvalKey], () => data.removeValuePair(critKey));
    data.removeValuePair(critKey);
    await getActiveArea()?.update("node", data.id);
    bumpConnectionVersion();
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      {op !== "countifs" && (
        <MeasuredSocketRow side="input" socketKey="values" nodeId={data.id} emit={emit} payload={data.inputs.values!.socket}>
          <span className="solenoid-node__io-label">Values</span>
          {connected.has("values") && (
            <span className="solenoid-node__io-wired" title="Driven by the incoming cable named here">↩ {incoming.get("values")?.label || "wired"}</span>
          )}
        </MeasuredSocketRow>
      )}
      {pairs.map(([critKey, cvalKey], i) => {
        const id = critKey.slice(4);
        const c = rowCfg(id);
        return (
          <div key={critKey} className="solenoid-node__pair-group">
            <MeasuredSocketRow side="input" socketKey={critKey} nodeId={data.id} emit={emit} payload={data.inputs[critKey]!.socket}>
              <span className="solenoid-node__io-label">Criteria{pairs.length > 1 ? ` ${i + 1}` : ""}</span>
              {connected.has(critKey) && (
                <span className="solenoid-node__io-wired" title="Driven by the incoming cable named here">↩ {incoming.get(critKey)?.label || "wired"}</span>
              )}
              {pairs.length > 1 && (
                <button
                  type="button"
                  className="solenoid-node__row-remove"
                  title="Remove this criterion"
                  onClick={(e) => { e.stopPropagation(); void removePair(critKey, cvalKey); }}
                >
                  ×
                </button>
              )}
            </MeasuredSocketRow>
            <OpSelect value={c.op} options={FILTER_OP_OPTIONS} onChange={(next) => updateCfg(id, { op: next })} />
            <MeasuredSocketRow side="input" socketKey={cvalKey} nodeId={data.id} emit={emit} payload={data.inputs[cvalKey]!.socket}>
              <span className="solenoid-node__io-label">Value</span>
              {connected.has(cvalKey) ? (
                <span className="solenoid-node__io-wired" title="Driven by an incoming cable">↩ wired</span>
              ) : (
                <InlineTextField value={strLiterals[cvalKey]} onChange={(v) => setStr(cvalKey, v)} />
              )}
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
