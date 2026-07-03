import type { ExpectNode as ExpectNodeType } from "../rete-nodes";
import { EXPECT_CHECK_LABEL } from "../nodes/quality";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { processGraph } from "../process";
import { solError } from "../errorValue";
import { ErrorChip } from "./ErrorChip";
import type { DisplayValue } from "./valueDisplayFormat";

type CheckKey = "checkNotNull" | "checkUnique" | "checkRange" | "checkRegex";

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
  const toggle = (key: CheckKey) => (v: boolean) => {
    data[key] = v;
    void processGraph(data.id);
  };

  return (
    <NodeShell node={data} emit={emit}>
      <CheckRow label="Not null" checked={data.checkNotNull} onChange={toggle("checkNotNull")} />
      <CheckRow label="Unique (list)" checked={data.checkUnique} onChange={toggle("checkUnique")} />
      <CheckRow label="In range" checked={data.checkRange} onChange={toggle("checkRange")} />
      {data.checkRange && <InlineInputs node={data} emit={emit} keys={["min", "max"]} />}
      <CheckRow label="Matches regex" checked={data.checkRegex} onChange={toggle("checkRegex")} />
      {data.checkRegex && <InlineInputs node={data} emit={emit} keys={["pattern"]} />}
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
