import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CableSwitchNode as CableSwitchNodeType } from "../rete-nodes";
// getActiveEditor/getActiveArea, NOT getEditor/getArea: a drill-in Input Switch
// must retype/prune/refresh on its OWN graph.
import { processGraph, bumpConnectionVersion, pushHistory } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { collapseStore } from "../collapseStore";
import { pushRowRemovalUndo, pushRowAddUndo } from "./ExtensibleInputs";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { NodeSocket } from "./NodeSocket";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { isSvgValue } from "../svgValue";
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
import { SvgFigure } from "./SvgFigure";
import "./CableSwitchNode.css";
import { dropInputCables } from "./cablePrune";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// The selected value is `any`, so render BY KIND like Display — never stringified;
// figures/cubes that would overflow the narrow card show as a chip.
function SwitchValue({ value, label, nodeId }: { value: unknown; label?: string; nodeId: string }) {
  if (isFrameValue(value)) return <FrameDisplay frame={value} label={label} />;
  // A display-value box so NodeCard measures it (--out-socket-top centers the
  // output socket on it).
  if (isCubeValue(value)) return <div className="solenoid-node__display-value" style={{ display: "flex", justifyContent: "flex-end" }}><CubeChip value={value} label={label} size="sm" accent="var(--sock-cube)" /></div>;
  if (isChartValue(value)) return <div className="solenoid-node__display-value" style={{ display: "flex", justifyContent: "flex-end" }}><ChartChip value={value} label={label} /></div>;
  if (isMermaidValue(value)) return <MermaidView source={value.source} />;
  if (isSvgValue(value)) return <SvgFigure value={value} height={120} />;
  if (isLambdaValue(value)) return <div className="solenoid-node__display-value">{formatLambda(value)}</div>;
  if (Array.isArray(value) && Array.isArray((value as unknown[])[0])) {
    return <TableDisplay table={value as number[][]} label={label} elem={nodeOutputElemFamily(nodeId)} />;
  }
  return <ValueDisplay value={value as number | number[] | string | string[] | null} />;
}

// A separate component so the title's useDraftCommit hook count stays stable as
// rows are added and removed.
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
      // A title relabels the multi-select cube's `name` column, so multi mode must
      // recompute; single mode only re-renders.
      if (data.multiSelect) void processGraph();
      else void getActiveArea()?.update("node", data.id);
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
          title="Remove this input"
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
    // Output is a Cube in Many mode, `any` in One — retype in place, so the
    // downstream cables the new type can't feed must be dropped here.
    const changed = data.syncOutputType();
    const ed = getActiveEditor();
    const area = getActiveArea();
    if (changed && ed && area) void retypeOutputCables(ed, area, data.id, "out");
    void area?.update("node", data.id);
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
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }
  async function removeRow(key: string) {
    await dropInputCables(data.id, [key]);
    // AFTER the connection removals, BEFORE the removal (see ExtensibleInputs).
    pushRowRemovalUndo(data, [key], () => data.removeValueInput(key));
    const prevActive = data.activeIndex;
    data.removeValueInput(key); // re-points activeIndex at the same slot it named
    setSelKeys(data.selectedKeys); // removeValueInput drops the key from the selection
    setSelected(data.activeIndex);
    if (data.activeIndex !== prevActive) {
      const nextActive = data.activeIndex;
      // Its own history entry, pushed AFTER the row entry so undo restores the
      // index LAST (the row comes back first).
      pushHistory(
        () => { data.activeIndex = prevActive; void getActiveArea()?.update("node", data.id); void processGraph(); },
        () => { data.activeIndex = nextActive; void getActiveArea()?.update("node", data.id); void processGraph(); },
      );
    }
    await getActiveArea()?.update("node", data.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processGraph();
  }

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
        <SwitchValue value={data.cachedValue} label={data.label} nodeId={data.id} />
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
      <SegToggle arg
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
            {/* Lucide "rotate-cw" (ISC). */}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            Cycle
          </button>
        )}
      </div>
      <SwitchValue value={data.cachedValue} label={data.label} nodeId={data.id} />
    </NodeShell>
  );
}
