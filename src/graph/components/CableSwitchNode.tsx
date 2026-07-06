import { useEffect, useState, useSyncExternalStore } from "react";
import type { CableSwitchNode as CableSwitchNodeType } from "../rete-nodes";
import { getEditor, getArea, processGraph, bumpConnectionVersion, pushHistory } from "../process";
import { collapseStore } from "../collapseStore";
import { pushRowRemovalUndo, pushRowAddUndo } from "./ExtensibleInputs";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { NodeSocket } from "./NodeSocket";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { isLambdaValue, formatLambda } from "../nodes/lambda";
import { useDraftCommit } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { FrameDisplay } from "./FrameDisplay";
import { CubeChip } from "./CubeChip";
import { TableDisplay } from "./TableDisplay";
import { ChartChip } from "./ChartChip";
import { MermaidView } from "./MermaidView";
import "./CableSwitchNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// The selected value is `any`, so render it by kind the way the Display node
// does — never stringified to [object Object]. A figure/cube that would overflow
// the narrow control card shows as a compact chip (opens the full view); the
// flatter kinds (frame grid, table, scalar) render inline as before.
function SwitchValue({ value, label }: { value: unknown; label?: string }) {
  if (isFrameValue(value)) return <FrameDisplay frame={value} label={label} />;
  // A display-value box so NodeCard measures it (--out-socket-top → the collapsed
  // input pill + output socket center on it); right-aligned like every value chip.
  if (isCubeValue(value)) return <div className="solenoid-node__display-value" style={{ display: "flex", justifyContent: "flex-end" }}><CubeChip value={value} label={label} accent="var(--sock-cube)" /></div>;
  if (isChartValue(value)) return <div className="solenoid-node__display-value" style={{ display: "flex", justifyContent: "flex-end" }}><ChartChip value={value} label={label} /></div>;
  if (isMermaidValue(value)) return <MermaidView source={value.source} />;
  if (isLambdaValue(value)) return <div className="solenoid-node__display-value">{formatLambda(value)}</div>;
  if (Array.isArray(value) && Array.isArray((value as unknown[])[0])) {
    return <TableDisplay table={value as number[][]} label={label} />;
  }
  return <ValueDisplay value={value as number | number[] | string | string[] | null} />;
}

// One input slot: a selector (route radio in single mode / include checkbox in
// multi mode) + an editable title so it reads as a named choice. A separate
// component so its title's useDraftCommit hook count stays stable as rows add/remove.
function SwitchOptionRow({ data, emit, keyName, index, multiSelect, active, checked, onSelect, onToggle, onRemove, canRemove }: {
  data: CableSwitchNodeType;
  emit: NodeProps<CableSwitchNodeType>["emit"];
  keyName: string;
  index: number;
  multiSelect: boolean;
  active: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const title = useDraftCommit<string>(
    data.titles[keyName] ?? "",
    (v) => v,
    (t) => t,
    (v) => {
      if (v.trim()) data.titles[keyName] = v;
      else delete data.titles[keyName];
      // A title relabels the multi-select cube's `name` column → recompute in multi
      // mode; single mode only needs a re-render.
      if (data.multiSelect) void processGraph();
      else void getArea()?.update("node", data.id);
    },
  );
  const input = data.inputs[keyName];
  if (!input) return null;
  return (
    <MeasuredSocketRow side="input" socketKey={keyName} nodeId={data.id} emit={emit} payload={input.socket}>
      {multiSelect ? (
        <input
          type="checkbox"
          className="sol-switch__check"
          checked={checked}
          title="Include this input in the collected cube"
          onChange={(e) => { e.stopPropagation(); onToggle(); }}
          onPointerDown={stop}
          onMouseDown={stop}
        />
      ) : (
        <button
          type="button"
          className={`sol-switch__opt${active ? " sol-switch__opt--on" : ""}`}
          title="Route this input to the output"
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          onPointerDown={stop}
          onMouseDown={stop}
        >
          {index + 1}
        </button>
      )}
      <input
        type="text"
        className="sol-switch__title"
        value={title.draft}
        placeholder={`Input ${index + 1}`}
        onChange={(e) => title.setDraft(e.target.value)}
        onBlur={title.onBlur}
        onKeyDown={title.onKeyDown}
        onPointerDown={stop}
        onMouseDown={stop}
      />
      {canRemove && (
        <button
          type="button"
          className="solenoid-node__row-remove"
          title="Remove input"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >×</button>
      )}
    </MeasuredSocketRow>
  );
}

export function CableSwitchComponent({ data, emit }: NodeProps<CableSwitchNodeType>) {
  const [selected, setSelected] = useState(data.activeIndex);
  useEffect(() => { setSelected(data.activeIndex); }, [data.activeIndex]);
  const [multi, setMulti] = useState(data.multiSelect);
  useEffect(() => { setMulti(data.multiSelect); }, [data.multiSelect]);
  const [selKeys, setSelKeys] = useState<string[]>(data.selectedKeys);
  useEffect(() => { setSelKeys(data.selectedKeys); }, [data.selectedKeys]);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const keys = Object.keys(data.inputs);
  const selSet = new Set(selKeys);

  function select(i: number) {
    data.activeIndex = i;
    setSelected(i);
    void processGraph();
  }
  function cycle() {
    if (keys.length) select((data.activeIndex + 1) % keys.length);
  }
  function setMode(many: boolean) {
    data.multiSelect = many;
    setMulti(many);
    void processGraph();
  }
  function toggleMulti(key: string) {
    const set = new Set(data.selectedKeys);
    if (set.has(key)) set.delete(key); else set.add(key);
    data.selectedKeys = [...set];
    setSelKeys(data.selectedKeys);
    void processGraph();
  }
  async function addRow() {
    const key = data.addValueInput();
    pushRowAddUndo(data, [key], () => data.removeValueInput(key));
    await getArea()?.update("node", data.id);
    await processGraph();
  }
  async function removeRow(key: string) {
    const editor = getEditor();
    if (editor) {
      for (const c of editor.getConnections()) {
        if (c.target === data.id && c.targetInput === key) await editor.removeConnection(c.id);
      }
    }
    // AFTER the connection removals, BEFORE the removal (see ExtensibleInputs).
    pushRowRemovalUndo(data, [key], () => data.removeValueInput(key));
    data.removeValueInput(key);
    setSelKeys(data.selectedKeys); // removeValueInput drops the key from the selection
    const n = Object.keys(data.inputs).length;
    if (data.activeIndex >= n) {
      const prevActive = data.activeIndex;
      const clamped = Math.max(0, n - 1);
      data.activeIndex = clamped;
      setSelected(clamped);
      // The clamp is its own history entry, pushed AFTER the row entry so undo
      // restores the index LAST (row back first; data() clamps the transient
      // out-of-range render). The component re-syncs off data.activeIndex on
      // the area update the entry triggers.
      pushHistory(
        () => { data.activeIndex = prevActive; void getArea()?.update("node", data.id); void processGraph(); },
        () => { data.activeIndex = clamped; void getArea()?.update("node", data.id); void processGraph(); },
      );
    }
    await getArea()?.update("node", data.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processGraph();
  }

  // Collapsed: the option rows fold into the shared stadium input pill (≥2 inputs)
  // or a lone centred socket, matching every other extensible node; the selected
  // value (or collected cube) still shows below.
  if (collapsed) {
    return (
      <NodeShell node={data} emit={emit}>
        {keys.length >= 2 ? (
          <CollapsedInputPill node={data} emit={emit} keys={keys} />
        ) : (
          keys.map((key) => {
            const input = data.inputs[key];
            return input ? (
              <NodeSocket key={key} side="input" socketKey={key} nodeId={data.id} emit={emit} payload={input.socket} />
            ) : null;
          })
        )}
        <SwitchValue value={data.cachedValue} label={data.label} />
      </NodeShell>
    );
  }

  return (
    <NodeShell node={data} emit={emit}>
      {keys.map((key, i) => (
        <SwitchOptionRow
          key={key}
          data={data}
          emit={emit}
          keyName={key}
          index={i}
          multiSelect={multi}
          active={i === selected}
          checked={selSet.has(key)}
          onSelect={() => select(i)}
          onToggle={() => toggleMulti(key)}
          onRemove={() => void removeRow(key)}
          canRemove={keys.length > 2}
        />
      ))}
      <SegToggle
        value={multi ? "many" : "one"}
        options={[
          { value: "one", label: "One", title: "Route one input to the output" },
          { value: "many", label: "Many", title: "Collect the checked inputs into a Cube" },
        ]}
        onChange={(v) => setMode(v === "many")}
        className="sol-switch__mode"
      />
      <div className="sol-switch__controls">
        <button type="button" className="solenoid-node__add-input" onClick={(e) => { e.stopPropagation(); void addRow(); }}>+ Add</button>
        {!multi && (
          <button type="button" className="sol-switch__cycle" title="Cycle to the next input" onClick={(e) => { e.stopPropagation(); cycle(); }} onPointerDown={stop} onMouseDown={stop}>
            {/* Lucide "rotate-cw" (ISC) — an icon, not a font glyph. */}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            Cycle
          </button>
        )}
      </div>
      <SwitchValue value={data.cachedValue} label={data.label} />
    </NodeShell>
  );
}
