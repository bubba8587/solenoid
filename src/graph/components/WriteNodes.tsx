import { useEffect, useState, useSyncExternalStore } from "react";
import type { WriteFileNode as WriteFileNodeType, WriteObsidianNode as WriteObsidianNodeType, WriteFormat } from "../rete-nodes";
import { isDesktop, listVaultFolders } from "../fileBridge";
import { settingsStore } from "../settingsStore";
import { isDocumentValue } from "../documentValue";
import { FrameDisplay } from "./FrameDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SegToggle } from "./SegToggle";
import "./ConnectionNodes.css";
import "./WriteNodes.css";
import { stopDragStart } from "../coarse";

// `data.run()` touches disk, so it must fire ONLY from the explicit Run click below —
// never from a graph recompute.

type WriteNodeData = WriteFileNodeType & {
  path: string; format: WriteFormat; enabled: boolean; status: string; statusMessage: string;
  browse(): Promise<void>; run(): Promise<void>;
};

const FORMAT_OPTIONS = [
  { value: "csv" as const, label: "CSV", title: "Comma-separated values (.csv)" },
  { value: "json" as const, label: "JSON", title: "Array of row records (.json)" },
];

export function WriteFileComponent({ data, emit }: NodeProps<WriteFileNodeType>) {
  const d = data as unknown as WriteNodeData;
  const [path, setPath] = useState(d.path);
  const [format, setFormat] = useState<WriteFormat>(d.format);
  const [armed, setArmed] = useState(d.enabled);
  const [status, setStatus] = useState(d.status);
  const [message, setMessage] = useState(d.statusMessage);
  const desktop = isDesktop();
  const ext = format === "json" ? "json" : "csv";

  useEffect(() => { setPath(d.path); }, [d.path]);

  function pickFormat(next: WriteFormat) {
    d.format = next;
    setFormat(next);
  }

  function commitPath() {
    const next = path.trim();
    d.path = next;
    setPath(next);
  }

  async function browse() {
    await d.browse();
    setPath(d.path);
  }

  function toggleArmed() {
    d.enabled = !d.enabled;
    setArmed(d.enabled);
  }

  async function run() {
    // Set "writing" synchronously — awaiting first leaves the button clickable (double-click race).
    setStatus("writing");
    await d.run();
    setStatus(d.status);
    setMessage(d.statusMessage);
  }

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Write File">
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        <SegToggle value={format} onChange={pickFormat} options={FORMAT_OPTIONS} arg />
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
            onPointerDown={stopDragStart}
            onMouseDown={(e) => e.stopPropagation()}
          />
          {desktop && (
            <button
              type="button"
              className="sol-conn__refresh"
              title="Choose a file"
              onClick={(e) => { e.stopPropagation(); void browse(); }}
              onPointerDown={stopDragStart}
              onMouseDown={(e) => e.stopPropagation()}
            >
              …
            </button>
          )}
        </div>
        <div className="sol-write__row">
          <label
            className="sol-write__armed"
            onPointerDown={stopDragStart}
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
            onPointerDown={stopDragStart}
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
        <FrameDisplay frame={d.cachedFrame} label={d.label} />
      </div>
    </NodeShell>
  );
}

// Same arm/disarm discipline as the file sinks: Run is the only thing that writes.

type WriteObsidianData = WriteObsidianNodeType & {
  fileName: string; subfolder: string; enabled: boolean; status: string; statusMessage: string;
  run(): Promise<void>;
};

const stopPtr = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };

export function WriteObsidianComponent({ data, emit }: NodeProps<WriteObsidianNodeType>) {
  const d = data as unknown as WriteObsidianData;
  const [name, setName] = useState(d.fileName);
  const [subfolder, setSubfolder] = useState(d.subfolder);
  const [armed, setArmed] = useState(d.enabled);
  const [status, setStatus] = useState(d.status);
  const [message, setMessage] = useState(d.statusMessage);
  const [folders, setFolders] = useState<string[]>([]);
  const desktop = isDesktop();
  const vault = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("obsidianVault"));

  useEffect(() => { setName(d.fileName); }, [d.fileName]);

  // Re-lists the vault's subfolders whenever the vault path changes.
  useEffect(() => {
    let live = true;
    void listVaultFolders(vault).then((f) => { if (live) setFolders(f); });
    return () => { live = false; };
  }, [vault]);

  function refreshFolders() { void listVaultFolders(vault).then(setFolders); }

  function commitName() {
    const next = name.trim();
    d.fileName = next;
    setName(next);
  }

  function pickSubfolder(v: string) { d.subfolder = v; setSubfolder(v); }
  function toggleArmed() { d.enabled = !d.enabled; setArmed(d.enabled); }

  async function run() {
    setStatus("writing");
    await d.run();
    setStatus(d.status);
    setMessage(d.statusMessage);
  }

  const doc = d.cachedDoc;
  const preview = isDocumentValue(doc)
    ? `${doc.frontmatter ? "note" : "report"} · ${doc.body.length} char${doc.body.length === 1 ? "" : "s"}`
    : null;

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Write to Obsidian">
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        {!desktop && <div className="sol-conn__note">Writing to a vault is available in the desktop app only.</div>}
        {desktop && vault.trim() === "" && <div className="sol-conn__note">Set the Obsidian vault folder in Settings.</div>}
        <input
          className="sol-conn__url"
          type="text"
          value={name}
          placeholder="Note name"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          {...stopPtr}
        />
        <div style={{ display: "flex", gap: 4 }}>
          <select
            className="sol-conn__select"
            style={{ flex: 1 }}
            value={subfolder}
            onChange={(e) => pickSubfolder(e.target.value)}
            {...stopPtr}
          >
            <option value="">Vault root</option>
            {/* A previously-picked folder that no longer lists still shows so the
                selection isn't silently lost. */}
            {subfolder && !folders.includes(subfolder) && <option value={subfolder}>{subfolder}</option>}
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button
            type="button"
            className="sol-conn__refresh"
            title="Rescan vault folders"
            onClick={(e) => { e.stopPropagation(); refreshFolders(); }}
            {...stopPtr}
          >
            ⟳
          </button>
        </div>
        <div className="sol-write__row">
          <label className="sol-write__armed" {...stopPtr}>
            <input type="checkbox" checked={armed} disabled={!desktop} onChange={toggleArmed} />
            Armed
          </label>
          <button
            type="button"
            className="sol-write__run"
            disabled={!desktop || !armed || name.trim() === "" || vault.trim() === "" || status === "writing"}
            title="Write the note now"
            onClick={(e) => { e.stopPropagation(); void run(); }}
            {...stopPtr}
          >
            Run
          </button>
        </div>
        {message !== "" && (
          <div className={`sol-conn__status-text${status === "error" ? " sol-conn__status-text--error" : ""}`} title={message}>
            {message}
          </div>
        )}
        {preview && <div className="sol-conn__note">{preview}</div>}
      </div>
    </NodeShell>
  );
}
