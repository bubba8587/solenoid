// [[C100]] chartIsAValue
import { useSyncExternalStore, type ReactNode } from "react";
import { collapseStore } from "../collapseStore";
import type { ChartBuilderNode as ChartBuilderNodeType } from "../rete-nodes";
import { CHART_BUILDER_TARGETS, CHART_TARGET_LIST, chartBuilderKeys, type ChartBuilderKey, type ChartTargetId } from "../nodes/chartOptions";
import { COLORMAP_LIST } from "../colormaps";
import { NodeShell, ArgSelect, useNodeField, type NodeProps, type ShellNode, type Emit } from "./nodeKit";
import { InlineInputs, useConnectedInputs, useIncomingSources } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
import { dropInputCables } from "./cablePrune";
import { stopDragStart } from "../coarse";
import { CardSection, useRowsInUse } from "./CardSection";

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

type SelectOption = { value: string; label: string; group?: string };

function SelectInputRow({ node, emit, socketKey, label, options, clearValue }: {
  node: ShellNode & { stringLiterals: Record<string, string> };
  emit: Emit;
  socketKey: string;
  label: string;
  options: readonly SelectOption[];
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

const STR_KEYS: readonly ChartBuilderKey[] = ["title", "xlabel", "ylabel", "color", "x", "y", "s", "c", "annotate", "by", "fmt", "window", "columns"];

const CMAP_OPTS: readonly SelectOption[] = [
  { value: "", label: "Theme palette", group: "Palette" },
  ...COLORMAP_LIST.map((m) => ({ value: m.name, label: m.name, group: m.family })),
  ...COLORMAP_LIST.map((m) => ({ value: `${m.name}_r`, label: `${m.name}_r`, group: "Reversed" })),
];
const TOGGLE_KEYS: readonly { key: ChartBuilderKey; label: string }[] =
  [{ key: "grid", label: "Grid" }, { key: "marker", label: "Markers" }, { key: "clamp", label: "Clamp tiles" }];
const SELECT_KEYS: readonly {
  key: ChartBuilderKey;
  label: string;
  options: readonly SelectOption[];
  clearValue: string;
}[] = [
  { key: "cmap", label: "Colormap", clearValue: "", options: CMAP_OPTS },
  {
    key: "annot", label: "Cell values", clearValue: "",
    options: [{ value: "", label: "When they fit" }, { value: "on", label: "Always" }, { value: "off", label: "Hidden" }],
  },
  { key: "cbar", label: "Colorbar", clearValue: "on", options: [{ value: "on", label: "Shown" }, { value: "off", label: "Hidden" }] },
  { key: "origin", label: "First row", clearValue: "upper", options: [{ value: "upper", label: "Top" }, { value: "lower", label: "Bottom" }] },
  {
    key: "pielabels", label: "Pie labels", clearValue: "outside",
    options: [
      { value: "outside", label: "Outside" },
      { value: "inside", label: "On slice" },
      { value: "off", label: "Off" },
    ],
  },
  {
    key: "linestyle", label: "Line style", clearValue: "",
    options: [
      { value: "", label: "Default" },
      { value: "none", label: "None" },
      { value: "solid", label: "Solid" },
      { value: "dashed", label: "Dashed" },
      { value: "dotted", label: "Dotted" },
      { value: "dashdot", label: "Dash-dot" },
    ],
  },
  {
    key: "aspect", label: "Aspect", clearValue: "auto",
    options: [
      { value: "auto", label: "Fill the plot" },
      { value: "equal", label: "Equal x and y" },
    ],
  },
  {
    key: "radarscale", label: "Radar scale", clearValue: "axis",
    options: [
      { value: "axis", label: "Per axis" },
      { value: "shared", label: "Shared" },
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
    options: [{ value: "2", label: "Two" }, { value: "1", label: "One" }],
  },
  {
    key: "layout", label: "Layout", clearValue: "gantt",
    options: [{ value: "gantt", label: "Timeline" }, { value: "calendar", label: "Month calendar" }],
  },
  {
    key: "fit", label: "Fit", clearValue: "off",
    options: [{ value: "off", label: "Zoom preset" }, { value: "page", label: "Whole plan" }],
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
      { value: "open", label: "All levels" },
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
// A select's default is the figure's own: a Heatmap draws square cells, a 2-D histogram fills the plot with y growing upward.
const TARGET_DEFAULTS: Partial<Record<ChartTargetId, Partial<Record<ChartBuilderKey, string>>>> = {
  heatmap: { aspect: "equal" },
  histogram2d: { origin: "lower" },
};
const NUM_KEYS: readonly ChartBuilderKey[] = ["xmin", "xmax", "ymin", "ymax", "center", "vmin", "vmax", "linewidth", "markersize", "alpha", "fontsize"];

// A target offering more rows than this folds its secondary ones into sections; a shorter card stays uncaptioned.
const SECTIONED_ABOVE = 10;
// Keys in no section (the title, axis labels, font size, a few one-figure settings) stay at the top.
const SECTIONS: readonly { label: string; keys: readonly ChartBuilderKey[] }[] = [
  { label: "Columns", keys: ["x", "y", "s", "c", "annotate", "by"] },
  { label: "Style", keys: ["color", "linestyle", "linewidth", "marker", "markersize", "alpha"] },
  { label: "Axes", keys: ["grid", "aspect", "xmin", "xmax", "ymin", "ymax", "radarscale", "origin"] },
  { label: "Color scale", keys: ["cmap", "center", "vmin", "vmax", "cbar", "annot", "fmt"] },
  { label: "Timeline", keys: ["zoom", "tiers", "fit", "window", "columns", "collapse", "group_by"] },
  { label: "Shown", keys: ["critical", "baseline", "arrows", "today", "status", "weekends", "labels", "histogram", "minutes"] },
  { label: "Calendar", keys: ["week", "fiscal_start"] },
];
// Inside its section a row drops the words the caption already says; the socket keeps its full name for the collapsed card and cables.
const SECTION_LABELS: Partial<Record<ChartBuilderKey, string>> = {
  x: "X", y: "Y", s: "Size", c: "Color", annotate: "Labels",
  linestyle: "Line",
  vmin: "Min", vmax: "Max", center: "Center",
};
const SECTIONED = new Set<ChartBuilderKey>(SECTIONS.flatMap((sec) => sec.keys));
const KIND_ORDER: readonly ChartBuilderKey[] = [
  ...STR_KEYS, ...TOGGLE_KEYS.map(({ key }) => key), ...SELECT_KEYS.map(({ key }) => key), ...NUM_KEYS,
];
const TOGGLE_BY_KEY = new Map(TOGGLE_KEYS.map((t) => [t.key, t]));
const SELECT_BY_KEY = new Map(SELECT_KEYS.map((t) => [t.key, t]));

/** The rows for `keys` in order: runs of text and number keys share one InlineInputs, toggles and selects draw their own rows. */
function BuilderRows({ node, emit, keys, clearFor, short }: {
  node: ChartBuilderNodeType; emit: Emit; keys: readonly ChartBuilderKey[];
  clearFor: (key: ChartBuilderKey, clear: string) => string;
  short?: boolean;
}) {
  const labelOf = (key: string, full: string) => (short && SECTION_LABELS[key as ChartBuilderKey]) || full;
  const out: ReactNode[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(<InlineInputs key={`in-${run[0]}`} node={node} emit={emit} keys={run}
      labelFor={short ? (k) => labelOf(k, node.inputs[k]?.label ?? k) : undefined} />);
    run = [];
  };
  for (const key of keys) {
    const toggle = TOGGLE_BY_KEY.get(key);
    const select = SELECT_BY_KEY.get(key);
    if (toggle) { flush(); out.push(<ToggleInputRow key={key} node={node} emit={emit} socketKey={key} label={labelOf(key, toggle.label)} />); }
    else if (select) {
      flush();
      out.push(<SelectInputRow key={key} node={node} emit={emit} socketKey={key} label={labelOf(key, select.label)} options={select.options} clearValue={clearFor(key, select.clearValue)} />);
    } else run.push(key);
  }
  flush();
  return <>{out}</>;
}

function BuilderSection({ node, emit, label, keys, clearFor }: {
  node: ChartBuilderNodeType; emit: Emit; label: string; keys: readonly ChartBuilderKey[];
  clearFor: (key: ChartBuilderKey, clear: string) => string;
}) {
  const inUse = useRowsInUse(node, keys);
  return (
    <CardSection label={label} collapsible defaultOpen={inUse} sockets={{ node, emit, keys }}>
      <BuilderRows node={node} emit={emit} keys={keys} clearFor={clearFor} short />
    </CardSection>
  );
}

export function ChartBuilderComponent({ data, emit }: NodeProps<ChartBuilderNodeType>) {
  const out = data.outputs.result;
  const [target, setTarget] = useNodeField(data, "target");
  async function pickTarget(next: ChartTargetId) {
    if (next === data.target) return;
    const keep = new Set<string>(chartBuilderKeys(next, data.stringLiterals["layout"]));
    await dropInputCables(data.id, (k) => k !== "result" && !keep.has(k));
    data.setTarget(next);
    setTarget(next);
  }
  const connected = useConnectedInputs(data.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
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
  const clearFor = (key: ChartBuilderKey, clear: string) => TARGET_DEFAULTS[target]?.[key] ?? clear;
  const sectioned = accepted.size > SECTIONED_ABOVE;
  const inertLabel = target === "gantt" && (data.stringLiterals["layout"] ?? "").trim().toLowerCase() === "calendar"
    ? "the Gantt calendar" : spec.label;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div style={{ padding: "2px 0 4px" }}>
        <ArgSelect value={target} onChange={(t) => void pickTarget(t)} options={TARGET_OPTS} />
      </div>
      {collapsed ? (
        // Collapsed, one InlineInputs carries every shown input: the toggle and select rows would hide their sockets, and two groups would draw two pills.
        <InlineInputs node={data} emit={emit} keys={[
          ...acc(STR_KEYS), ...TOGGLE_KEYS.filter(({ key }) => accepted.has(key)).map(({ key }) => key),
          ...SELECT_KEYS.filter(({ key }) => accepted.has(key)).map(({ key }) => key), ...acc(NUM_KEYS),
          ...inertStr, ...inertToggles.map(({ key }) => key), ...inertSelects.map(({ key }) => key), ...inertNum,
        ] as string[]} />
      ) : <>
      <BuilderRows node={data} emit={emit} keys={sectioned ? KIND_ORDER.filter((k) => accepted.has(k) && !SECTIONED.has(k)) : acc(KIND_ORDER)} clearFor={clearFor} />
      {sectioned && SECTIONS.map(({ label, keys }) => {
        const shown = acc(keys);
        return shown.length > 0 && <BuilderSection key={label} node={data} emit={emit} label={label} keys={shown} clearFor={clearFor} />;
      })}
      {anyInert && (
        <CardSection label={`Not used by ${inertLabel}`}>
          <div style={{ opacity: 0.45 }}>
            <InlineInputs node={data} emit={emit} keys={inertStr as string[]} />
            {inertToggles.map(({ key, label }) => (
              <ToggleInputRow key={key} node={data} emit={emit} socketKey={key} label={label} />
            ))}
            {inertSelects.map(({ key, label, options, clearValue }) => (
              <SelectInputRow key={key} node={data} emit={emit} socketKey={key} label={label} options={options} clearValue={clearFor(key, clearValue)} />
            ))}
            <InlineInputs node={data} emit={emit} keys={inertNum as string[]} />
          </div>
        </CardSection>
      )}
      </>}
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
