import { BLEND_MODE_META } from "../rete-nodes";
import type { ColorBlendNode as ColorBlendNodeType, BlendMode } from "../rete-nodes";
import { isSolError } from "../errorValue";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { ErrorChip } from "./ErrorChip";

const MODE_OPTS = (Object.keys(BLEND_MODE_META) as BlendMode[]).map((m) => ({
  value: m,
  label: BLEND_MODE_META[m].label,
}));

export function ColorBlendComponent({ data, emit }: NodeProps<ColorBlendNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const out = data.cachedString;
  const colorOut = data.outputs.color;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      {/* Direct body child — the top-of-card op-selector hoist (nodeCard.css
          flex order) only reaches unwrapped selects. */}
      <OpSelect value={op} onChange={setOp} options={MODE_OPTS} />
      {colorOut && (
        <MeasuredSocketRow side="output" socketKey="color" nodeId={data.id} emit={emit} payload={colorOut.socket}>
          {isSolError(out) ? (
            <ErrorChip err={out} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
              <span
                aria-label="Color preview"
                style={{ width: 18, height: 18, borderRadius: 5, border: "1px solid var(--border-strong)", background: out ?? "transparent", flex: "0 0 auto" }}
              />
              <code style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{out ?? "—"}</code>
            </div>
          )}
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}
