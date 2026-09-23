import type { CubeInputNode as CubeInputNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { CubeDisplay } from "./CubeDisplay";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { nodeDisplayName } from "../catalogUtils";
import { parseCubeRecords, cubeRecordsToText, type CubeRecord } from "../literalEditors";

// [[C28]] literalsIffEditable
export function CubeInputComponent({ data, emit }: NodeProps<CubeInputNodeType>) {
  const edit = {
    records: (): CubeRecord[] => { const p = parseCubeRecords(data.cubeText); return "records" in p ? p.records : []; },
    save: (records: CubeRecord[]) => {
      data.cubeText = cubeRecordsToText(records);
      scheduleAutosave();
      void processGraph();
    },
  };
  return (
    <NodeShell node={data} emit={emit}>
      <CubeDisplay cube={data.cachedResult} label={nodeDisplayName(data)} edit={edit} />
    </NodeShell>
  );
}
