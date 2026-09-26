// [[C100]] chartIsAValue
import type { ChartBuilderNode as ChartBuilderNodeType } from "../rete-nodes";
import { CHART_BUILDER_TARGETS, CHART_TARGET_LIST, chartBuilderKeys, type ChartBuilderKey } from "../nodes/chartOptions";
import { NodeShell, ArgSelect, useNodeField, type NodeProps, type ShellNode, type Emit } from "./nodeKit";
import { InlineInputs, useConnectedInputs, useIncomingSources } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
import { stopDragStart } from "../coarse";

const isOnValue = (s: string | undefined) => {
  const v = (s ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1" || v === "yes";
};

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

function SelectInputRow({ node, emit, socketKey, label, options, clearValue }: {
  node: ShellNode & { stringLiterals: Record<string, string> };
  emit: Emit;
  socketKey: string;
  label: string;
  options: readonly { value: string; label: string }[];
  clearValue?: string;
}) {
  const connected = useConnectedInputs(node.id);
  const incoming = useIncomingSources(node.id);
  const port = node.inputs[socketKey];
  if (!port) return null;
  const wired = connected.has(socketKey);
  const value = node.stringLiterals[socketKey] || clearValue || options[0].value;
  const set = (v: string) => {
    node.stringLiterals[socketKey] = v === clearValue ? "" : v;
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
        <ArgSelect value={value} onChange={set} options={options} />
      )}
    </MeasuredSocketRow>
  );
}

const TARGET_OPTS = CHART_TARGET_LIST.map((t) => ({ value: t.id, label: t.label, group: t.group }));

const STR_KEYS: readonly ChartBuilderKey[] = ["title", "xlabel", "ylabel", "color", "x", "y", "s", "c", "annotate", "by", "window", "columns"];
const TOGGLE_KEYS: readonly { key: ChartBuilderKey; label: string }[] =
  [{ key: "grid", label: "Grid" }, { key: "marker", label: "Markers" }, { key: "clamp", label: "Clamp tiles" }];
const SELECT_KEYS: readonly {
  key: ChartBuilderKey;
  label: string;
  options: readonly { value: string; label: string }[];
  clearValue: string;
}[] = [
  {
    key: "pielabels", label: "Pie labels", clearValue: "outside",
    options: [
      { value: "outside", label: "Labels: outside" },
      { value: "inside", label: "Labels: on slice" },
      { value: "off", label: "Labels: off" },
    ],
  },
  {
    key: "linestyle", label: "Line style", clearValue: "",
    options: [
      { value: "", label: "Lines: default" },
      { value: "none", label: "Lines: none" },
      { value: "solid", label: "Lines: solid" },
      { value: "dashed", label: "Lines: dashed" },
      { value: "dotted", label: "Lines: dotted" },
      { value: "dashdot", label: "Lines: dash-dot" },
    ],
  },
  {
    key: "aspect", label: "Aspect", clearValue: "auto",
    options: [
      { value: "auto", label: "Aspect: fill the plot" },
      { value: "equal", label: "Aspect: equal x and y" },
    ],
  },
  {
    key: "radarscale", label: "Radar scale", clearValue: "axis",
    options: [
      { value: "axis", label: "Scale: per axis" },
      { value: "shared", label: "Scale: shared" },
    ],
  },
  {
    key: "zoom", label: "Zoom", clearValue: "fit",
    options: [
      { value: "fit", label: "Fit the width" },
      { value: "day", label: "Days" },
      { value: "week", label: "Weeks" },
      { value: "month", label: "Months" },
      { value: "quarter", label: "Quarters" },
      { value: "year", label: "Years" },
    ],
  },
  {
    key: "tiers", label: "Header rows", clearValue: "2",
    options: [{ value: "2", label: "Two rows" }, { value: "1", label: "One row" }],
  },
  {
    key: "layout", label: "Layout", clearValue: "gantt",
    options: [{ value: "gantt", label: "Timeline" }, { value: "calendar", label: "Month calendar" }],
  },
  {
    key: "fit", label: "Fit", clearValue: "off",
    options: [{ value: "off", label: "The zoom preset" }, { value: "page", label: "Whole plan, one width" }],
  },
  { key: "critical", label: "Critical path", clearValue: "on", options: [{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }] },
  { key: "baseline", label: "Baseline", clearValue: "on", options: [{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }] },
  { key: "arrows", label: "Arrows", clearValue: "on", options: [{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }] },
  { key: "today", label: "Today line", clearValue: "on", options: [{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }] },
  { key: "weekends", label: "Weekend shading", clearValue: "on", options: [{ value: "on", label: "Shaded" }, { value: "off", label: "Plain" }] },
  { key: "labels", label: "Bar labels", clearValue: "on", options: [{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }] },
  { key: "histogram", label: "Resource band", clearValue: "off", options: [{ value: "off", label: "Hidden" }, { value: "on", label: "Shown" }] },
  { key: "minutes", label: "Times", clearValue: "off", options: [{ value: "off", label: "Whole days" }, { value: "on", label: "To the minute" }] },
  { key: "status", label: "Status line", clearValue: "on", options: [{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }] },
  { key: "group_by", label: "Project groups", clearValue: "on", options: [{ value: "on", label: "Grouped" }, { value: "off", label: "One list" }] },
  {
    key: "collapse", label: "Outline", clearValue: "open",
    options: [
      { value: "open", label: "Every level" },
      { value: "0", label: "Top level" },
      { value: "1", label: "Two levels" },
      { value: "2", label: "Three levels" },
    ],
  },
  {
    key: "week", label: "Week numbers", clearValue: "iso",
    options: [{ value: "iso", label: "ISO, Monday first" }, { value: "us", label: "US, Sunday first" }],
  },
  {
    key: "fiscal_start", label: "Fiscal year starts", clearValue: "1",
    options: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
      .map((m, i) => ({ value: String(i + 1), label: m })),
  },
  {
    key: "cardsize", label: "Tile size", clearValue: "m",
    options: [{ value: "s", label: "Small" }, { value: "m", label: "Medium" }, { value: "l", label: "Large" }],
  },
];
const NUM_KEYS: readonly ChartBuilderKey[] = ["xmin", "xmax", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];

export function ChartBuilderComponent({ data, emit }: NodeProps<ChartBuilderNodeType>) {
  const out = data.outputs.result;
  const [target, setTarget] = useNodeField(data, "target");
  const connected = useConnectedInputs(data.id);
  const spec = CHART_BUILDER_TARGETS[target];
  const accepted = new Set<string>(chartBuilderKeys(target, data.stringLiterals["layout"]));
  const live = (k: ChartBuilderKey) =>
    connected.has(k) || (data.stringLiterals[k] ?? "") !== "" || data.literals[k] !== undefined;
  const acc = (keys: readonly ChartBuilderKey[]) => keys.filter((k) => accepted.has(k));
  const inert = (keys: readonly ChartBuilderKey[]) => keys.filter((k) => !accepted.has(k) && live(k));
  const inertStr = inert(STR_KEYS);
  const inertToggles = TOGGLE_KEYS.filter(({ key }) => !accepted.has(key) && live(key));
  const inertSelects = SELECT_KEYS.filter(({ key }) => !accepted.has(key) && live(key));
  const inertNum = inert(NUM_KEYS);
  const anyInert = inertStr.length > 0 || inertToggles.length > 0 || inertSelects.length > 0 || inertNum.length > 0;
  const inertLabel = target === "gantt" && (data.stringLiterals["layout"] ?? "").trim().toLowerCase() === "calendar"
    ? "the Gantt calendar" : spec.label;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div style={{ padding: "2px 0 4px" }}>
        <ArgSelect value={target} onChange={setTarget} options={TARGET_OPTS} />
      </div>
      <InlineInputs node={data} emit={emit} keys={acc(STR_KEYS) as string[]} />
      {TOGGLE_KEYS.filter(({ key }) => accepted.has(key)).map(({ key, label }) => (
        <ToggleInputRow key={key} node={data} emit={emit} socketKey={key} label={label} />
      ))}
      {SELECT_KEYS.filter(({ key }) => accepted.has(key)).map(({ key, label, options, clearValue }) => (
        <SelectInputRow key={key} node={data} emit={emit} socketKey={key} label={label} options={options} clearValue={clearValue} />
      ))}
      <InlineInputs node={data} emit={emit} keys={acc(NUM_KEYS) as string[]} />
      {anyInert && (
        <div style={{ opacity: 0.45 }} title={`Not read by ${inertLabel}`}>
          <InlineInputs node={data} emit={emit} keys={inertStr as string[]} />
          {inertToggles.map(({ key, label }) => (
            <ToggleInputRow key={key} node={data} emit={emit} socketKey={key} label={label} />
          ))}
          {inertSelects.map(({ key, label, options, clearValue }) => (
            <SelectInputRow key={key} node={data} emit={emit} socketKey={key} label={label} options={options} clearValue={clearValue} />
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
              fontFamily: "var(--font-mono)",
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
