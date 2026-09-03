import type { ChartBuilderNode as ChartBuilderNodeType } from "../rete-nodes";
import { CHART_BUILDER_TARGETS, CHART_TARGET_LIST, type ChartBuilderKey } from "../nodes/chartOptions";
import { NodeShell, ArgSelect, useNodeField, type NodeProps, type ShellNode, type Emit } from "./nodeKit";
import { InlineInputs, useConnectedInputs, useIncomingSources } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
import { stopDragStart } from "../coarse";

const isOnValue = (s: string | undefined) => {
  const v = (s ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1" || v === "yes";
};

/** A checkbox writing "on"/"off" into the options string, still a wireable input
 *  (a cable replaces the checkbox with its source). */
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
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: 14, height: 14, cursor: "pointer", flex: "0 0 auto" }}
        />
      )}
    </MeasuredSocketRow>
  );
}

const TARGET_OPTS = CHART_TARGET_LIST.map((t) => ({ value: t.id, label: t.label }));

const STR_KEYS: readonly ChartBuilderKey[] = ["title", "xlabel", "ylabel", "color"];
const TOGGLE_KEYS: readonly { key: ChartBuilderKey; label: string }[] =
  [{ key: "grid", label: "Grid" }, { key: "marker", label: "Markers" }, { key: "pielabels", label: "Pie labels" }];
const NUM_KEYS: readonly ChartBuilderKey[] = ["ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];

/** The chart-type dropdown shapes the form, but a WIRED or valued row stays
 *  visible (dimmed) so switching type never hides live state — and every set field
 *  serializes, so one builder can feed several chart types. */
export function ChartBuilderComponent({ data, emit }: NodeProps<ChartBuilderNodeType>) {
  const out = data.outputs.result;
  const [target, setTarget] = useNodeField(data, "target");
  const connected = useConnectedInputs(data.id);
  const spec = CHART_BUILDER_TARGETS[target] ?? CHART_BUILDER_TARGETS.chart;
  const accepted = new Set<string>(spec.keys);
  // Wired or valued — stays on screen even when inert.
  const live = (k: ChartBuilderKey) =>
    connected.has(k) || (data.stringLiterals[k] ?? "") !== "" || data.literals[k] !== undefined;
  const acc = (keys: readonly ChartBuilderKey[]) => keys.filter((k) => accepted.has(k));
  const inert = (keys: readonly ChartBuilderKey[]) => keys.filter((k) => !accepted.has(k) && live(k));
  const inertStr = inert(STR_KEYS);
  const inertToggles = TOGGLE_KEYS.filter(({ key }) => !accepted.has(key) && live(key));
  const inertNum = inert(NUM_KEYS);
  const anyInert = inertStr.length > 0 || inertToggles.length > 0 || inertNum.length > 0;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div style={{ padding: "2px 0 4px" }}>
        <ArgSelect value={target} onChange={setTarget} options={TARGET_OPTS} />
      </div>
      <InlineInputs node={data} emit={emit} keys={acc(STR_KEYS) as string[]} />
      {TOGGLE_KEYS.filter(({ key }) => accepted.has(key)).map(({ key, label }) => (
        <ToggleInputRow key={key} node={data} emit={emit} socketKey={key} label={label} />
      ))}
      <InlineInputs node={data} emit={emit} keys={acc(NUM_KEYS) as string[]} />
      {anyInert && (
        <div style={{ opacity: 0.45 }} title={`Not read by ${spec.label}`}>
          <InlineInputs node={data} emit={emit} keys={inertStr as string[]} />
          {inertToggles.map(({ key, label }) => (
            <ToggleInputRow key={key} node={data} emit={emit} socketKey={key} label={label} />
          ))}
          <InlineInputs node={data} emit={emit} keys={inertNum as string[]} />
        </div>
      )}
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
