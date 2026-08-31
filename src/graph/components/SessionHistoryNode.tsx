import { useEffect, useRef, useState } from "react";
import { copyText } from "../clipboard";
import type { SessionHistoryNode as SessionHistoryNodeType } from "../rete-nodes";
import { digestLabeled } from "../historyDigest";
import { flowHistory } from "../flow/flowHistory";
import type { NodeProps } from "./nodeKit";
import { stopDragStart } from "../coarse";
import "./SessionHistoryNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

// The snapshot history has no change event to subscribe to, so the digest is
// recomputed on an interval while the node is mounted.
const POLL_MS = 1000;

function buildDigest(): string {
  return digestLabeled(flowHistory.records());
}

/** A live readout of the session's undo/redo stack — no sockets and no persisted
 *  state; a dashboard onto app history, not graph data. */
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
          className="solenoid-history__copy sol-copy-icon"
          title={copied ? "Copied!" : "Copy digest"}
          onClick={handleCopy}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        />
      </div>
      <pre className="solenoid-history__log nowheel" onPointerDown={stop} onMouseDown={stop}>{digest}</pre>
    </div>
  );
}
