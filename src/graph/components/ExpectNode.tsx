import { useEffect, useState } from "react";
import type { ExpectNode as ExpectNodeType } from "../rete-nodes";
import { EXPECT_CHECK_LABEL } from "../nodes/quality";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { InlineInputs, InlineCsvField, useConnectedInputs, useIncomingSources } from "./inlineInput";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
import { solError } from "../errorValue";
import { ErrorChip } from "./ErrorChip";
import type { DisplayValue } from "./valueDisplayFormat";

type CheckKey = "checkNotNull" | "checkUnique" | "checkRange" | "checkRegex" | "checkAllowed";

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "1px 0", cursor: "pointer" }}
      onPointerDown={(e) => e.stopPropagation()}
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

/**
 * Expect — "Data Validation, generalized". Four opt-in checks against whatever
 * flows through; always pass-through (the value keeps moving even on failure).
 * A failure shows the shared red ErrorChip badge (not the output — that stays
 * the real value) and fires an Alert on the first occurrence of a NEW failure.
 */
export function ExpectComponent({ data, emit }: NodeProps<ExpectNodeType>) {
  const connected = useConnectedInputs(data.id);
  const incoming = useIncomingSources(data.id);
  // The checkboxes are CONTROLLED, so their `checked` must be React state — mutating
  // the node property + processGraph doesn't re-render this component (the pass-through
  // value is unchanged), so React would reset the box to its last-rendered value and
  // the toggle would appear to do nothing. Mirror to state here; write to the node in
  // the handler. (Same pattern the Format Controller uses — see nodeKit gotchas.)
  const [checks, setChecks] = useState({
    checkNotNull: data.checkNotNull, checkUnique: data.checkUnique,
    checkRange: data.checkRange, checkRegex: data.checkRegex, checkAllowed: data.checkAllowed,
  });
  // Resync if the flags change externally (paste, load, undo).
  useEffect(() => {
    setChecks({
      checkNotNull: data.checkNotNull, checkUnique: data.checkUnique,
      checkRange: data.checkRange, checkRegex: data.checkRegex, checkAllowed: data.checkAllowed,
    });
  }, [data.checkNotNull, data.checkUnique, data.checkRange, data.checkRegex, data.checkAllowed]);
  const toggle = (key: CheckKey) => (v: boolean) => {
    data[key] = v;
    setChecks((c) => ({ ...c, [key]: v }));
    void processGraph(data.id);
  };

  // A wired socket must never disappear (its cable endpoint would dangle), so a
  // check's rows stay visible while connected even with the check toggled off.
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
      <CheckRow label="Not null" checked={checks.checkNotNull} onChange={toggle("checkNotNull")} />
      <CheckRow label="Unique (list)" checked={checks.checkUnique} onChange={toggle("checkUnique")} />
      <CheckRow label="In range" checked={checks.checkRange} onChange={toggle("checkRange")} />
      {showRange && <InlineInputs node={data} emit={emit} keys={["min", "max"]} />}
      <CheckRow label="Matches regex" checked={checks.checkRegex} onChange={toggle("checkRegex")} />
      {showRegex && <InlineInputs node={data} emit={emit} keys={["pattern"]} />}
      <CheckRow label="In list" checked={checks.checkAllowed} onChange={toggle("checkAllowed")} />
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
      <ValueDisplay value={data.cachedValue as DisplayValue} />
      {data.violations.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
          <ErrorChip
            err={solError("#VALUE!", `Failed: ${data.violations.map((v) => EXPECT_CHECK_LABEL[v]).join(", ")}`)}
          />
        </div>
      )}
    </NodeShell>
  );
}
