import { useCallback, useEffect, useState } from "react";
import { AngleDialNode } from "../nodes/control";
import { AngleDial } from "../AngleDial";
import { NodeShell, NodeProps } from "./nodeKit";
import { processGraph } from "../process";
import "./AngleDialNode.css";

function normalise(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

export function AngleDialComponent({ data, emit }: NodeProps<AngleDialNode>) {
  const [degrees, setDegrees] = useState(data.value);
  const [draft, setDraft] = useState(String(Math.round(data.value)));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDegrees(data.value);
      setDraft(String(Math.round(data.value)));
    }
  }, [data.value, editing]);

  const commit = useCallback((next: number) => {
    const clamped = normalise(Math.round(next));
    setDegrees(clamped);
    setDraft(String(clamped));
    data.value = clamped;
    void processGraph(data.id);
  }, [data]);

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Angle" collapsible={false} className="solenoid-node--angle-dial">
      <div className="angle-dial-node">
        <div className="angle-dial-node__dial-row">
          <AngleDial
            value={degrees}
            step={data.step}
            onChange={commit}
            size={72}
          />
        </div>
        <div className="angle-dial-node__input-row">
          <input
            className="angle-dial-node__input"
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={e => { setEditing(true); setDraft(e.target.value); }}
            onBlur={() => {
              setEditing(false);
              const parsed = Number(draft);
              commit(Number.isFinite(parsed) ? parsed : degrees);
            }}
            onKeyDown={e => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { setDraft(String(Math.round(degrees))); setEditing(false); e.currentTarget.blur(); }
            }}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          />
          <span className="angle-dial-node__unit">°</span>
        </div>
      </div>
    </NodeShell>
  );
}
