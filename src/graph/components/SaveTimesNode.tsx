import type { SaveTimesNode as SaveTimesNodeType } from "../rete-nodes";
import { saveToDisk } from "../fileSession";
import { requestRecalc } from "../process";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { RefreshIcon } from "./RefreshIcon";
import { SaveIcon } from "./SaveIcon";
import { stopDragStart } from "../coarse";
import "./ConnectionNodes.css";
import "./SaveTimesNode.css";

function RowButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="sol-conn__refresh"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}

export function SaveTimesComponent({ data, emit }: NodeProps<SaveTimesNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <span className="solenoid-node__io-label sol-savetimes__label">Autosaved</span>
      <MeasuredSocketRow side="output" socketKey="autosave" nodeId={data.id} emit={emit} payload={data.outputs.autosave!.socket} hero>
        <div className="sol-savetimes__row">
          <ValueDisplay value={data.cachedAutosave} socketKey="autosave" />
          <RowButton title="Re-read the save clock" onClick={() => void requestRecalc()}>
            <RefreshIcon />
          </RowButton>
        </div>
      </MeasuredSocketRow>

      <span className="solenoid-node__io-label sol-savetimes__label">Saved to file</span>
      <MeasuredSocketRow side="output" socketKey="filesave" nodeId={data.id} emit={emit} payload={data.outputs.filesave!.socket} hero>
        <div className="sol-savetimes__row">
          <ValueDisplay value={data.cachedFileSave} socketKey="filesave" />
          <RowButton title="Save (Ctrl+S)" onClick={() => void saveToDisk().then(() => requestRecalc())}>
            <SaveIcon size={12} />
          </RowButton>
        </div>
      </MeasuredSocketRow>
    </NodeShell>
  );
}
