import { useEffect, useState } from "react";
import type { WriteCsvNode as WriteCsvNodeType, WriteJsonNode as WriteJsonNodeType } from "../rete-nodes";
import { isDesktop } from "../fileBridge";
import { FrameDisplay } from "./FrameDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import "./ConnectionNodes.css";
import "./WriteNodes.css";

// ─── File sink nodes (Write CSV / Write JSON) ───────────────────────────────────
// The write action (`data.run()`) touches disk; it must run ONLY from the
// explicit Run click below — never from a graph recompute. This component's
// job is entirely local state (path/armed/status) mirrored onto the node
// instance for persistence, exactly the useNodeField pattern nodeKit.tsx
// documents for a controlled input driven off React state, not a forceUpdate.

type WriteNodeData = (WriteCsvNodeType | WriteJsonNodeType) & {
  path: string; enabled: boolean; status: string; statusMessage: string;
  browse(): Promise<void>; run(): Promise<void>;
};

function WriteFileComponent({
  data, emit, kindLabel, ext,
}: NodeProps<WriteNodeData> & { kindLabel: string; ext: string }) {
  const [path, setPath] = useState(data.path);
  const [armed, setArmed] = useState(data.enabled);
  const [status, setStatus] = useState(data.status);
  const [message, setMessage] = useState(data.statusMessage);
  const desktop = isDesktop();

  useEffect(() => { setPath(data.path); }, [data.path]);

  function commitPath() {
    const next = path.trim();
    data.path = next;
    setPath(next);
  }

  async function browse() {
    await data.browse();
    setPath(data.path);
  }

  function toggleArmed() {
    data.enabled = !data.enabled;
    setArmed(data.enabled);
  }

  async function run() {
    // Reflect "writing" synchronously so the button disables NOW — waiting for
    // the await leaves it clickable for the whole write (double-click race).
    setStatus("writing");
    await data.run();
    setStatus(data.status);
    setMessage(data.statusMessage);
  }

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder={kindLabel}>
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        {!desktop && <div className="sol-conn__note">Writing files is available in the desktop app only.</div>}
        <div style={{ display: "flex", gap: 4 }}>
          <input
            className="sol-conn__url"
            type="text"
            value={path}
            placeholder={`…/output.${ext}`}
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
            onBlur={commitPath}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          {desktop && (
            <button
              type="button"
              className="sol-conn__refresh"
              title="Choose a file"
              onClick={(e) => { e.stopPropagation(); void browse(); }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              …
            </button>
          )}
        </div>
        <div className="sol-write__row">
          <label
            className="sol-write__armed"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input type="checkbox" checked={armed} disabled={!desktop} onChange={toggleArmed} />
            Armed
          </label>
          <button
            type="button"
            className="sol-write__run"
            disabled={!desktop || !armed || path.trim() === "" || status === "writing"}
            title="Write the file now"
            onClick={(e) => { e.stopPropagation(); void run(); }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            Run
          </button>
        </div>
        {message !== "" && (
          <div
            className={`sol-conn__status-text${status === "error" ? " sol-conn__status-text--error" : ""}`}
            title={message}
          >
            {message}
          </div>
        )}
        <FrameDisplay frame={data.cachedFrame} label={data.label} />
      </div>
    </NodeShell>
  );
}

export function WriteCsvComponent(props: NodeProps<WriteCsvNodeType>) {
  return <WriteFileComponent {...(props as unknown as NodeProps<WriteNodeData>)} kindLabel="Write CSV" ext="csv" />;
}

export function WriteJsonComponent(props: NodeProps<WriteJsonNodeType>) {
  return <WriteFileComponent {...(props as unknown as NodeProps<WriteNodeData>)} kindLabel="Write JSON" ext="json" />;
}
