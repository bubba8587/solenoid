// [[C28]] literalsIffEditable
import { useEffect, useState } from "react";
import type { ExpectNode as ExpectNodeType } from "../rete-nodes";
import { EXPECT_CHECK_LABEL } from "../nodes/quality";
import { NodeShell, type NodeProps } from "./nodeKit";
import { ResultDisplay } from "./ResultDisplay";
import { nodeDisplayName } from "../catalogUtils";
import { InlineInputs, InlineCsvField, useConnectedInputs, useIncomingSources } from "./inlineInput";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
import { stopDragStart } from "../coarse";

type CheckKey = "checkNotNull" | "checkUnique" | "checkRange" | "checkRegex" | "checkAllowed";

/** A failing check's label turns the error color, so the card says which check failed where it was set. */
function CheckRow({ label, checked, failed, onChange }: { label: string; checked: boolean; failed?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "1px 0", cursor: "pointer", color: failed ? "var(--sol-error)" : undefined }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, flexShrink: 0 }}
      />
      {label}
    </label>
  );
}

/** Always pass-through: a failed check marks its row and the card and fires an Alert, but the output stays the real value. */
export function ExpectComponent({ data, emit }: NodeProps<ExpectNodeType>) {
  const connected = useConnectedInputs(data.id);
  const incoming = useIncomingSources(data.id);
  // The checkboxes are controlled and the pass-through value never changes, so a node-only write wouldn't re-render.
  const [checks, setChecks] = useState({
    checkNotNull: data.checkNotNull, checkUnique: data.checkUnique,
    checkRange: data.checkRange, checkRegex: data.checkRegex, checkAllowed: data.checkAllowed,
  });
  useEffect(() => {
    setChecks({
      checkNotNull: data.checkNotNull, checkUnique: data.checkUnique,
      checkRange: data.checkRange, checkRegex: data.checkRegex, checkAllowed: data.checkAllowed,
    });
  }, [data.checkNotNull, data.checkUnique, data.checkRange, data.checkRegex, data.checkAllowed]);
  const failed = new Set(data.violations);
  const toggle = (key: CheckKey) => (v: boolean) => {
    data[key] = v;
    setChecks((c) => ({ ...c, [key]: v }));
    void processGraph(data.id);
  };

  // A wired socket must never disappear (dangling endpoint), so connected rows stay shown.
  const showRange = checks.checkRange || connected.has("min") || connected.has("max");
  const showRegex = checks.checkRegex || connected.has("pattern");
  const showAllowed = checks.checkAllowed || connected.has("allowed");

  return (
    <NodeShell
      node={data}
      emit={emit}
      leading={
        data.inputs.in
          ? <NodeSocket side="input" socketKey="in" nodeId={data.id} emit={emit} payload={data.inputs.in.socket} />
          : null
      }
    >
      <CheckRow label="Not null" failed={failed.has("notNull")} checked={checks.checkNotNull} onChange={toggle("checkNotNull")} />
      <CheckRow label="Unique" failed={failed.has("unique")} checked={checks.checkUnique} onChange={toggle("checkUnique")} />
      <CheckRow label="In range" failed={failed.has("range")} checked={checks.checkRange} onChange={toggle("checkRange")} />
      {showRange && <InlineInputs node={data} emit={emit} keys={["min", "max"]} />}
      <CheckRow label="Matches regex" failed={failed.has("regex")} checked={checks.checkRegex} onChange={toggle("checkRegex")} />
      {showRegex && <InlineInputs node={data} emit={emit} keys={["pattern"]} />}
      <CheckRow label="In list" failed={failed.has("allowed")} checked={checks.checkAllowed} onChange={toggle("checkAllowed")} />
      {showAllowed && data.inputs.allowed && (
        <MeasuredSocketRow side="input" socketKey="allowed" nodeId={data.id} emit={emit} payload={data.inputs.allowed.socket}>
          <span className="solenoid-node__io-label">List</span>
          {connected.has("allowed") ? (
            <span className="solenoid-node__io-wired" title="Driven by the incoming cable named here">
              ↩ {incoming.get("allowed")?.label || "wired"}
            </span>
          ) : (
            <InlineCsvField
              value={data.stringLiterals.allowed}
              onChange={(v) => { data.stringLiterals.allowed = v; void processGraph(data.id); }}
            />
          )}
        </MeasuredSocketRow>
      )}
      <ResultDisplay value={data.cachedValue} label={nodeDisplayName(data)} />
      {data.violations.length > 0 && (
        <div style={{ textAlign: "right", fontSize: 11, marginTop: 3, color: "var(--sol-error)" }}>
          {`Failed: ${data.violations.map((v) => EXPECT_CHECK_LABEL[v]).join(", ")}`}
        </div>
      )}
    </NodeShell>
  );
}
