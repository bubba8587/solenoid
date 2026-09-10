import { useEffect, useState, useSyncExternalStore } from "react";
import type { WriteFileNode as WriteFileNodeType, WriteObsidianNode as WriteObsidianNodeType, WriteTasksNode as WriteTasksNodeType, WritePropertiesNode as WritePropertiesNodeType, WriteFormat } from "../rete-nodes";
import { isDesktop, listVaultFolders, openExternal, pickFolderDialog, baseNameOf } from "../fileBridge";
import { obsidianOpenUrl } from "../obsidianLinks";
import { settingsStore } from "../settingsStore";
import { documentStore } from "../documentStore";
import { isDocumentValue } from "../documentValue";
import { isFrameValue } from "../frame";
import { processGraph } from "../process";
import { FrameDisplay } from "./FrameDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SegToggle } from "./SegToggle";
import { OBSIDIAN_WRITE_MODE_OPTIONS } from "../nodes/obsidian";
import type { ObsidianWriteMode } from "../obsidianWrite";
import { renderNameTemplate, hasTemplateTokens, type NameTemplateContext } from "../nameTemplate";
import { stubRelPath } from "../graphStub";
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
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        <SegToggle value={format} onChange={pickFormat} options={FORMAT_OPTIONS} />
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
  fileName: string; subfolder: string; mode: ObsidianWriteMode; stamp: boolean; enabled: boolean; status: string; statusMessage: string; lastWritten: string;
  run(): Promise<void>;
  templateContext(docName: string): NameTemplateContext;
};

const stopPtr = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };

export function WriteObsidianComponent({ data, emit }: NodeProps<WriteObsidianNodeType>) {
  const d = data as unknown as WriteObsidianData;
  const [name, setName] = useState(d.fileName);
  const [subfolder, setSubfolder] = useState(d.subfolder);
  const [mode, setMode] = useState<ObsidianWriteMode>(d.mode);
  const [stamp, setStamp] = useState(d.stamp);
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
  function pickMode(v: ObsidianWriteMode) { d.mode = v; setMode(v); }
  function toggleArmed() { d.enabled = !d.enabled; setArmed(d.enabled); }
  function toggleStamp() { d.stamp = !d.stamp; setStamp(d.stamp); }

  async function run() {
    setStatus("writing");
    await d.run();
    setStatus(d.status);
    setMessage(d.statusMessage);
  }

  // A templated name shows what it renders to right now (the clock, or the wired date),
  // live off the draft so the preview follows the typing.
  const templated = hasTemplateTokens(name) || hasTemplateTokens(subfolder);
  const ctx = templated ? d.templateContext(documentStore.currentName()) : null;
  const rendered = ctx ? [renderNameTemplate(subfolder, ctx), renderNameTemplate(name, ctx)].filter(Boolean).join("/") + ".md" : "";

  const doc = d.cachedDoc;
  const preview = isDocumentValue(doc)
    ? `${doc.frontmatter ? "note" : "report"} · ${doc.body.length} char${doc.body.length === 1 ? "" : "s"}`
    : null;

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        {!desktop && <div className="sol-conn__note">Writing to a vault is available in the desktop app only.</div>}
        {desktop && vault.trim() === "" && <div className="sol-conn__note">Set the Obsidian vault folder in Settings.</div>}
        <input
          className="sol-conn__url"
          type="text"
          value={name}
          placeholder="Note name, or {{date}} / {{daily}}"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          {...stopPtr}
        />
        {rendered && <div className="sol-conn__note" title="What the name renders to now">{rendered}</div>}
        <SegToggle value={mode} options={OBSIDIAN_WRITE_MODE_OPTIONS} onChange={pickMode} />
        <label className="sol-write__armed" title="Add a solenoid: link on the note + a Solenoid/<graph> stub note" {...stopPtr}>
          <input type="checkbox" checked={stamp} onChange={toggleStamp} />
          Link to graph
        </label>
        {stamp && <div className="sol-conn__note" title="Stub note this write adds a solenoid: link to">+ {stubRelPath(documentStore.currentName())}</div>}
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
        {d.lastWritten && obsidianOpenUrl(vault, d.lastWritten) && (
          <button
            type="button"
            className="sol-write__run"
            title="Open the note in Obsidian"
            onClick={(e) => { e.stopPropagation(); void openExternal(obsidianOpenUrl(vault, d.lastWritten)!); }}
            {...stopPtr}
          >
            Open in Obsidian
          </button>
        )}
        {preview && <div className="sol-conn__note">{preview}</div>}
      </div>
    </NodeShell>
  );
}

// ─── WRITE TASKS ────────────────────────────────────────────────────────────────
// Same arm/disarm discipline; Preview reads, Run writes through the TaskNotes API.
export function WriteTasksComponent({ data, emit }: NodeProps<WriteTasksNodeType>) {
  const [keys, setKeys] = useState(data.stringLiterals.keys ?? "");
  const [armed, setArmed] = useState(data.enabled);
  const [status, setStatus] = useState<string>(data.status);
  const [message, setMessage] = useState(data.statusMessage);
  useEffect(() => { setKeys(data.stringLiterals.keys ?? ""); }, [data.stringLiterals.keys]);

  function commitKeys() {
    const next = keys.split(",").map((k) => k.trim()).filter(Boolean).join(", ");
    setKeys(next);
    if (next !== (data.stringLiterals.keys ?? "")) { data.stringLiterals.keys = next; void processGraph(); }
  }
  function toggleArmed() { data.enabled = !data.enabled; setArmed(data.enabled); }
  async function preview() {
    setStatus("previewing");
    await data.preview();
    setStatus(data.status); setMessage(data.statusMessage);
    void processGraph();
  }
  async function run() {
    setStatus("writing");
    await data.run();
    setStatus(data.status); setMessage(data.statusMessage);
  }
  const busy = status === "writing" || status === "previewing";
  const hasRows = isFrameValue(data.cachedPlan) && data.cachedPlan.columns[0].values.length > 0;

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        <input
          className="sol-conn__url"
          type="text"
          value={keys}
          placeholder="Fields to send (blank = all)"
          spellCheck={false}
          onChange={(e) => setKeys(e.target.value)}
          onBlur={commitKeys}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          {...stopPtr}
        />
        <div className="sol-write__row">
          <button
            type="button"
            className="sol-write__run"
            disabled={!hasRows || busy}
            title="Read the current tasks and mark the rows that would not change"
            onClick={(e) => { e.stopPropagation(); void preview(); }}
            {...stopPtr}
          >
            Preview
          </button>
          <label className="sol-write__armed" {...stopPtr}>
            <input type="checkbox" checked={armed} onChange={toggleArmed} />
            Armed
          </label>
          <button
            type="button"
            className="sol-write__run"
            disabled={!armed || !hasRows || busy}
            title="Create and update the tasks now"
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
        <FrameDisplay frame={data.cachedPlan} label={data.label || "Write Tasks"} />
      </div>
    </NodeShell>
  );
}


// ─── WRITE PROPERTIES (a cube → notes' frontmatter) ──────────────────────────────
// Preview + Armed + Run like Write Tasks; a per-node vault chip; writes only from Run.
export function WritePropertiesComponent({ data, emit }: NodeProps<WritePropertiesNodeType>) {
  const [keys, setKeys] = useState(data.stringLiterals.keys ?? "");
  const [armed, setArmed] = useState(data.enabled);
  const [addMissing, setAddMissing] = useState(data.addMissing);
  const [writeBase, setWriteBase] = useState(data.writeBase);
  const [status, setStatus] = useState<string>(data.status);
  const [message, setMessage] = useState(data.statusMessage);
  const desktop = isDesktop();
  useEffect(() => { setKeys(data.stringLiterals.keys ?? ""); }, [data.stringLiterals.keys]);

  async function chooseVault() {
    const picked = await pickFolderDialog();
    if (picked && picked !== data.vault) { data.vault = picked; void processGraph(); }
  }
  function commitKeys() {
    const next = keys.split(",").map((k) => k.trim()).filter(Boolean).join(", ");
    setKeys(next);
    if (next !== (data.stringLiterals.keys ?? "")) { data.stringLiterals.keys = next; void processGraph(); }
  }
  function toggleArmed() { data.enabled = !data.enabled; setArmed(data.enabled); }
  function toggleAddMissing() { data.addMissing = !data.addMissing; setAddMissing(data.addMissing); void processGraph(); }
  function toggleWriteBase() { data.writeBase = !data.writeBase; setWriteBase(data.writeBase); }
  async function preview() {
    setStatus("previewing");
    await data.preview();
    setStatus(data.status); setMessage(data.statusMessage);
    void processGraph();
  }
  async function run() {
    setStatus("writing");
    await data.run();
    setStatus(data.status); setMessage(data.statusMessage);
  }
  const busy = status === "writing" || status === "previewing";
  const hasRows = isFrameValue(data.cachedPlan) && data.cachedPlan.columns[0].values.length > 0;

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        <div className="sol-conn__vault">
          <span className="sol-conn__chip" title={data.vault || "No vault chosen"}>
            {data.vault ? baseNameOf(data.vault) : "No vault"}
          </span>
          {desktop && (
            <button type="button" className="sol-conn__refresh" title="Choose the vault folder"
              onClick={(e) => { e.stopPropagation(); void chooseVault(); }} {...stopPtr}>Choose…</button>
          )}
        </div>
        <input
          className="sol-conn__url" type="text" value={keys} placeholder="Properties to write (blank = all)" spellCheck={false}
          onChange={(e) => setKeys(e.target.value)} onBlur={commitKeys}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          {...stopPtr}
        />
        <label className="sol-write__armed" title="Add + register a property the note doesn't have yet" {...stopPtr}>
          <input type="checkbox" checked={addMissing} onChange={toggleAddMissing} />
          Add missing
        </label>
        <label className="sol-write__armed" title="Also write a <node>.base view beside the notes" {...stopPtr}>
          <input type="checkbox" checked={writeBase} onChange={toggleWriteBase} />
          Write .base
        </label>
        <div className="sol-write__row">
          <button type="button" className="sol-write__run" disabled={!hasRows || busy}
            title="Read the notes and mark what each write would do"
            onClick={(e) => { e.stopPropagation(); void preview(); }} {...stopPtr}>Preview</button>
          <label className="sol-write__armed" {...stopPtr}>
            <input type="checkbox" checked={armed} onChange={toggleArmed} />
            Armed
          </label>
          <button type="button" className="sol-write__run" disabled={!armed || !hasRows || busy}
            title="Write the properties into the notes now"
            onClick={(e) => { e.stopPropagation(); void run(); }} {...stopPtr}>Run</button>
        </div>
        {message !== "" && (
          <div className={`sol-conn__status-text${status === "error" ? " sol-conn__status-text--error" : ""}`} title={message}>
            {message}
          </div>
        )}
        <FrameDisplay frame={data.cachedPlan} label={data.label || "Write Properties"} />
      </div>
    </NodeShell>
  );
}
