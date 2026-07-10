import type { ChartBuilderNode as ChartBuilderNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps, type ShellNode, type Emit } from "./nodeKit";
import { InlineInputs, useConnectedInputs, useIncomingSources } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";

const isOnValue = (s: string | undefined) => {
  const v = (s ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1" || v === "yes";
};

/**
 * A boolean option rendered as a checkbox that writes "on"/"off" into the
 * options string — but still a wireable input socket (shows the wired source
 * instead of the checkbox when a cable feeds it).
 */
function ToggleInputRow({ node, emit, socketKey, label }: {
  node: ShellNode & { stringLiterals: Record<string, string> };
  emit: Emit;
  socketKey: string;
  label: string;
}) {
  const connected = useConnectedInputs(node.id);
  const incoming = useIncomingSources(node.id);
  const port = node.inputs[socketKey];
  if (!port) return null;
  const wired = connected.has(socketKey);
  const on = isOnValue(node.stringLiterals[socketKey]);
  const set = (checked: boolean) => {
    node.stringLiterals[socketKey] = checked ? "on" : "off";
    void processGraph();
  };
  return (
    <MeasuredSocketRow side="input" socketKey={socketKey} nodeId={node.id} emit={emit} payload={port.socket}>
      <span className="solenoid-node__io-label">{label}</span>
      {wired ? (
        <span className="solenoid-node__io-wired" title="Driven by the incoming cable named here">
          ↩ {incoming.get(socketKey)?.label || "wired"}
        </span>
      ) : (
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => set(e.target.checked)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: 14, height: 14, cursor: "pointer", flex: "0 0 auto" }}
        />
      )}
    </MeasuredSocketRow>
  );
}

/**
 * Chart Builder — a labelled "Concat for chart options". Most rows are
 * InlineInputs (text/number fields that are also input sockets); Grid and
 * Markers are On/Off toggles. The node joins them into the `key=value;…` string
 * shown in the preview, which feeds a Chart's Options socket. The output socket
 * sits on the preview row, next to the string it emits.
 */
export function ChartBuilderComponent({ data, emit }: NodeProps<ChartBuilderNodeType>) {
  const out = data.outputs.result;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} keys={["title", "xlabel", "ylabel", "color"]} />
      <ToggleInputRow node={data} emit={emit} socketKey="grid" label="Grid" />
      <ToggleInputRow node={data} emit={emit} socketKey="marker" label="Markers" />
      <InlineInputs node={data} emit={emit} keys={["ymin", "ymax", "linewidth", "alpha", "fontsize"]} />
      <div className="solenoid-node__section-divider" />
      {out && (
        <MeasuredSocketRow side="output" socketKey="result" nodeId={data.id} emit={emit} payload={out.socket}>
          <code
            title={data.cachedString || "No options set"}
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              fontSize: 10,
              color: data.cachedString ? "var(--text-dim)" : "var(--text-muted)",
              fontFamily: "var(--mono-font, ui-monospace, monospace)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {data.cachedString || "No options set"}
          </code>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}
