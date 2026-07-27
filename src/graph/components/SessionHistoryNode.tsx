import { useEffect, useRef, useState } from "react";
import { copyText } from "../clipboard";
import type { SessionHistoryNode as SessionHistoryNodeType } from "../rete-nodes";
import { getEditor, getHistoryPlugin } from "../process";
import { nodeDisplayNames } from "../nodeNames";
import { digestHistory, type HistoryDigestRecord } from "../historyDigest";
import { ClipboardIcon } from "./nodeKit";
import type { NodeProps } from "./nodeKit";
import { stopDragStart } from "../coarse";
import "./SessionHistoryNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// Live, no config: recompute the digest on an interval while the node is
// mounted. rete-history-plugin exposes no change event to subscribe to (Canvas
// only calls history.add() imperatively), so polling is the simplest honest way
// to keep this "auto-generating" per the plan, without patching the plugin.
const POLL_MS = 1000;

function buildDigest(): string {
  const history = getHistoryPlugin();
  const editor = getEditor();
  if (!history) return "History plugin not ready.";
  const records = history.getHistorySnapshot() as unknown as HistoryDigestRecord[];
  const names = editor ? nodeDisplayNames(editor.getNodes()) : new Map<string, string>();
  return digestHistory(records, { nodeName: (id) => names.get(id) });
}

/**
 * A live readout of the session's undo/redo stack, distilled into a dated,
 * human-readable log (historyDigest.ts). No inputs/outputs, no persisted state —
 * it's a dashboard onto app history, not graph data. Copy button is the whole UI
 * beyond the readout itself.
 */
export function SessionHistoryComponent({ data }: NodeProps<SessionHistoryNodeType>) {
  const [digest, setDigest] = useState(buildDigest);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setDigest(buildDigest()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    void copyText(digest).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className={`solenoid-history${data.selected ? " solenoid-history--selected" : ""}`} style={{ width: data.width, height: data.height }}>
      <div className="solenoid-history__bar">
        <span className="solenoid-history__title">Session History</span>
        <button
          type="button"
          className="solenoid-history__copy"
          title={copied ? "Copied!" : "Copy digest"}
          onClick={handleCopy}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <ClipboardIcon />
        </button>
      </div>
      <pre className="solenoid-history__log" onPointerDown={stop} onMouseDown={stop}>{digest}</pre>
    </div>
  );
}
