import { useEffect, useState } from "react";
import type { CableSwitchNode as CableSwitchNodeType } from "../rete-nodes";
import { getEditor, getArea, processGraph, bumpConnectionVersion } from "../process";
import { isFrameValue } from "../frame";
import { useConnectedInputs } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { TableDisplay } from "./TableDisplay";
import "./CableSwitchNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// The selected value is `any`, so render it the way the Display node does.
function SwitchValue({ value, label }: { value: unknown; label?: string }) {
  if (isFrameValue(value)) return <FrameDisplay frame={value} label={label} />;
  if (Array.isArray(value) && Array.isArray((value as unknown[])[0])) {
    return <TableDisplay table={value as number[][]} label={label} />;
  }
  return <ValueDisplay value={value as number | number[] | string | string[] | null} />;
}

export function CableSwitchComponent({ data, emit }: NodeProps<CableSwitchNodeType>) {
  const [selected, setSelected] = useState(data.activeIndex);
  useEffect(() => { setSelected(data.activeIndex); }, [data.activeIndex]);
  const connected = useConnectedInputs(data.id);
  const keys = Object.keys(data.inputs);

  function select(i: number) {
    data.activeIndex = i;
    setSelected(i);
    void processGraph();
  }
  function cycle() {
    if (keys.length) select((data.activeIndex + 1) % keys.length);
  }
  async function addRow() {
    data.addValueInput();
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
    data.removeValueInput(key);
    const n = Object.keys(data.inputs).length;
    if (data.activeIndex >= n) { data.activeIndex = Math.max(0, n - 1); setSelected(data.activeIndex); }
    await getArea()?.update("node", data.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      {keys.map((key, i) => {
        const input = data.inputs[key];
        if (!input) return null;
        const active = i === selected;
        return (
          <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={data.id} emit={emit} payload={input.socket}>
            <button
              type="button"
              className={`sol-switch__opt${active ? " sol-switch__opt--on" : ""}`}
              title={`Route input ${i + 1} to the output`}
              onClick={(e) => { e.stopPropagation(); select(i); }}
              onPointerDown={stop}
              onMouseDown={stop}
            >
              {i + 1}
            </button>
            <span className="solenoid-node__io-label sol-switch__state" style={{ flex: 1 }}>
              {connected.has(key) ? "wired" : "—"}
            </span>
            {keys.length > 2 && (
              <button
                type="button"
                className="solenoid-node__row-remove"
                title="Remove input"
                onClick={(e) => { e.stopPropagation(); void removeRow(key); }}
              >×</button>
            )}
          </MeasuredSocketRow>
        );
      })}
      <div className="sol-switch__controls">
        <button type="button" className="solenoid-node__add-input" onClick={(e) => { e.stopPropagation(); void addRow(); }}>+ Add</button>
        <button type="button" className="sol-switch__cycle" title="Cycle to the next input" onClick={(e) => { e.stopPropagation(); cycle(); }} onPointerDown={stop} onMouseDown={stop}>
          {/* Lucide "rotate-cw" (ISC) — an icon, not a font glyph. */}
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          Cycle
        </button>
      </div>
      <SwitchValue value={data.cachedValue} label={data.label} />
    </NodeShell>
  );
}
