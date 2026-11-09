// [[C25]]

import { useRef, useState } from "react";
import type { UnitCircleNode as UnitCircleNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useConnectedInputs } from "./inlineInput";
import { FrameDisplay } from "./FrameDisplay";
import { AngleDial } from "../AngleDial";
import { isFrameValue, frameRowCount, type FrameValue } from "../frame";
import { isSolError } from "../errorValue";
import { processGraph } from "../process";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";
import { FrameOutRow, RowPager, stop, shortNum, labelWidth, LABEL_H, useAnchorTop } from "./GeometryFigure";
import { NodeSocket } from "./NodeSocket";

const W = 300, H = 236, R = 86;
const CX = W / 2, CY = H / 2;
/** The angles of a turn with exact values, marked on the circle. */
const MARKS = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];

function cellAt(frame: FrameValue | null, name: string, row: number): unknown {
  return frame?.columns.find((c) => c.name === name)?.values[row];
}
const numIn = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A leg's length on the figure, a bare value centered on its point: the name belongs to θ, in the readout. */
function Label({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div className="solenoid-geo__label" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}>
      <span className="solenoid-geo__value">{text}</span>
    </div>
  );
}

/** The Unit Circle card: the circle with the sine and cosine legs, its dial tucked in the top-left corner beside the
 *  angle's socket (the card's own angle, or the shown row's dimmed while wired) and the trig readout in the top-right,
 *  a pager through the rows, and the frame's Preview. */
export function UnitCircleComponent({ data, emit }: NodeProps<UnitCircleNodeType>) {
  const wired = useConnectedInputs(data.id).has("angle");
  const out = isFrameValue(data.cachedResult) ? data.cachedResult : null;
  const rows = out ? frameRowCount(out) : 0;
  const [shownRow, setShownRow] = useState(data.row);
  const row = Math.min(Math.max(0, shownRow), Math.max(0, rows - 1));
  const step = (d: number) => {
    data.row = Math.min(Math.max(0, row + d), Math.max(0, rows - 1));
    setShownRow(data.row);
  };

  const s = numIn(cellAt(out, "sin", row)), co = numIn(cellAt(out, "cos", row));
  const given = numIn(cellAt(out, "degrees", row));
  const standard = given === undefined ? undefined : ((given % 360) + 360) % 360;
  const exact = (name: string) => { const v = cellAt(out, name, row); return typeof v === "string" && v !== "" ? v : undefined; };
  const drawn = standard !== undefined && s !== undefined && co !== undefined;
  const px = CX + R * (co ?? 0), py = CY - R * (s ?? 0);

  const sinText = exact("sin exact") ?? (s === undefined ? "" : shortNum(s));
  const cosText = exact("cos exact") ?? (co === undefined ? "" : shortNum(co));
  const t = numIn(cellAt(out, "tan", row));
  const tanText = exact("tan exact") ?? (t === undefined ? "–" : shortNum(t));
  const sinW = labelWidth(sinText.length);
  const cosLabel = { x: (CX + px) / 2, y: CY + ((s ?? 0) >= 0 ? 1 : -1) * (LABEL_H / 2 + 3) };
  const sinLabel = { x: px + ((co ?? 1) >= 0 ? 1 : -1) * (sinW / 2 + 4), y: (CY + py) / 2 };
  const arcR = 18, rad = ((standard ?? 0) * Math.PI) / 180;
  const arc = standard ? `M ${CX + arcR} ${CY} A ${arcR} ${arcR} 0 ${standard > 180 ? 1 : 0} 0 ${CX + arcR * Math.cos(rad)} ${CY - arcR * Math.sin(rad)}` : null;

  const dialRef = useRef<HTMLDivElement>(null);
  const dialTop = useAnchorTop(dialRef);
  const dialValue = wired ? (standard ?? 0) : (data.literals.angle ?? 0);
  const turnDial = (deg: number) => {
    data.literals.angle = deg;
    void processGraph(data.id);
  };

  const port = data.inputs.angle;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      {dialTop !== undefined && port && <NodeSocket side="input" socketKey="angle" nodeId={data.id} emit={emit} payload={port.socket} top={dialTop} />}
      <div className="solenoid-geo__figure">
        <div className="solenoid-geo__stage">
          <svg viewBox={`0 0 ${W} ${H}`} className="solenoid-geo__svg" aria-hidden="true">
            <line x1={CX - R - 12} y1={CY} x2={CX + R + 12} y2={CY} stroke="var(--border-strong)" strokeWidth="1" />
            <line x1={CX} y1={CY - R - 12} x2={CX} y2={CY + R + 12} stroke="var(--border-strong)" strokeWidth="1" />
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" />
            {MARKS.map((m) => (
              <circle key={m} cx={CX + R * Math.cos((m * Math.PI) / 180)} cy={CY - R * Math.sin((m * Math.PI) / 180)} r="1.6" fill="var(--text-muted)" />
            ))}
            {drawn && (
              <>
                {arc && <path d={arc} fill="none" stroke="var(--text-muted)" strokeWidth="1" />}
                <line x1={CX} y1={CY} x2={px} y2={py} stroke="var(--text)" strokeWidth="1.5" />
                <line x1={CX} y1={CY} x2={px} y2={CY} stroke="var(--node-accent)" strokeWidth="2.5" />
                <line x1={px} y1={CY} x2={px} y2={py} stroke="var(--node-accent)" strokeWidth="2.5" strokeDasharray="4 3" />
                <circle cx={px} cy={py} r="3.5" fill="var(--text)" />
              </>
            )}
          </svg>
          {drawn && <Label text={cosText} x={cosLabel.x} y={cosLabel.y} />}
          {drawn && <Label text={sinText} x={sinLabel.x} y={sinLabel.y} />}
        </div>
        <div ref={dialRef} className={`solenoid-geo__dial${wired ? " solenoid-geo__dial--wired" : ""}`} onPointerDown={stop} onMouseDown={stop}>
          <AngleDial value={dialValue} step={15} size={48} counterclockwise onChange={turnDial} />
        </div>
        {given !== undefined && drawn && (
          <div className="solenoid-geo__readout">
            <span className="solenoid-geo__letter">θ</span><span className="solenoid-geo__value">{shortNum(given)}°</span>
            <span className="solenoid-geo__letter">sin θ</span><span className="solenoid-geo__value">{sinText}</span>
            <span className="solenoid-geo__letter">cos θ</span><span className="solenoid-geo__value">{cosText}</span>
            <span className="solenoid-geo__letter">tan θ</span><span className="solenoid-geo__value">{tanText}</span>
          </div>
        )}
        <RowPager row={row} rows={rows} onStep={step} />
      </div>
      <FrameOutRow node={data} socketKey="circle" emit={emit}>
        <FrameDisplay frame={previewed(() => (out ?? (isSolError(data.cachedResult) ? data.cachedResult : null)))} label={nodeDisplayName(data)} />
      </FrameOutRow>
    </NodeShell>
  );
}
