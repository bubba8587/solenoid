// [[B3]] sameNodeEverywhere
import { getOwningEditor } from "./activeGraph";
import { NoteNode, ReportNode } from "./rete-nodes";

/** The Report or Note behind a document id, in whichever graph holds it (a composite's included). */
export function documentSourceNode(nodeId: string | null | undefined): ReportNode | NoteNode | undefined {
  const n = nodeId ? getOwningEditor(nodeId)?.getNode(nodeId) : undefined;
  return n instanceof ReportNode || n instanceof NoteNode ? n : undefined;
}
