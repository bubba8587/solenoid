import { useCallback, useEffect, useState } from "react";
import { AngleDialNode } from "../nodes/control";
import { AngleDial } from "../AngleDial";
import { NodeShell, NodeProps } from "./nodeKit";
import { processGraph } from "../process";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import "./AngleDialNode.css";

function normalize(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

export function AngleDialComponent({ data, emit }: NodeProps<AngleDialNode>) {
  const [degrees, setDegrees] = useState(data.value);
  useEffect(() => { setDegrees(data.value); }, [data.value]);

  const commit = useCallback((next: number) => {
    const clamped = normalize(Math.round(next));
    setDegrees(clamped);
    data.value = clamped;
    void processGraph(data.id);
  }, [data]);
  const field = useDraftCommit(
    degrees,
    (v) => String(Math.round(v)),
    (t) => { const n = Number(t); return t.trim() !== "" && Number.isFinite(n) ? n : INVALID_DRAFT; },
    commit,
  );

  return (
    <NodeShell node={data} emit={emit} collapsible={false} className="solenoid-node--angle-dial">
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
            value={field.draft}
            onChange={e => field.setDraft(e.target.value)}
            onBlur={field.onBlur}
            onKeyDown={field.onKeyDown}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          />
          <span className="angle-dial-node__unit">°</span>
        </div>
      </div>
    </NodeShell>
  );
}
