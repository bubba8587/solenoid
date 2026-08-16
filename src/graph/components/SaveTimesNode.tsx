import { useSyncExternalStore } from "react";
import type { SaveTimesNode as SaveTimesNodeType } from "../rete-nodes";
import { saveTimeStore } from "../saveTimeStore";
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
  // The clock changes outside any recompute, so re-render on it; the boxes still show
  // what the SOCKETS emit (the cached serials), which only a recalc moves.
  useSyncExternalStore(saveTimeStore.subscribe, saveTimeStore.version);

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Save Times" hideOutputSockets>
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
