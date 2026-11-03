// [[B18]] safeToShare, [[B11]] maximalMerge, [[C26]] opArgDistinct
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WriteFileNode as WriteFileNodeType, WriteObsidianNode as WriteObsidianNodeType, WriteTasksNode as WriteTasksNodeType, WriteFormat } from "../nodeClasses";
import { hasFs, isDesktop, listVaultFolders, listVaultMarkdownFiles, openExternal } from "../fileBridge";
import { getVaultRoot } from "../demoVault";
import { obsidianOpenUrl } from "../obsidianLinks";
import { settingsStore } from "../settingsStore";
import { documentStore } from "../documentStore";
import { isDocumentValue } from "../documentValue";
import { isFrameValue } from "../frame";
import { notifyGraphChanged, processGraph } from "../process";
import { getOwningView } from "../activeGraph";
import { FrameDisplay } from "./FrameDisplay";
import { DocumentChip } from "./DocumentChip";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { dropInputCables } from "./cablePrune";
import { PickField } from "./PickField";
import { chooseFile } from "../chooseFile";
import { SegToggle } from "./SegToggle";
import { OBSIDIAN_WRITE_MODE_OPTIONS, OBSIDIAN_TARGET_OPTIONS, type WriteObsidianTarget } from "../nodes/obsidian";
import type { ObsidianWriteMode } from "../obsidianWrite";
import { connectionVersionStore } from "../graphSignals";
import { stubRelPath } from "../graphStub";
import "./ConnectionNodes.css";
import "./WriteNodes.css";
import "./ImportObsidianNode.css";
import { stopDragStart } from "../coarse";
import { previewed } from "../listPreview";

type WriteNodeData = WriteFileNodeType & {
  path: string; format: WriteFormat; enabled: boolean; status: string; statusMessage: string;
  browse(): Promise<void>; run(): Promise<void>;
};

const FORMAT_OPTIONS = [
  { value: "csv" as const, label: "CSV", title: "Comma-separated values (.csv)" },
  { value: "json" as const, label: "JSON", title: "Array of row records (.json)" },
  { value: "text" as const, label: "Text", title: "A wired string written as-is; name the file with its own extension (plan.xml)" },
];

export function WriteFileComponent({ data, emit }: NodeProps<WriteFileNodeType>) {
  const d = data as unknown as WriteNodeData;
  const [path, setPath] = useState(d.path);
  const [format, setFormat] = useState<WriteFormat>(d.format);
  const [armed, setArmed] = useState(d.enabled);
  const [status, setStatus] = useState(d.status);
  const [message, setMessage] = useState(d.statusMessage);
  const desktop = isDesktop();
  const ext = format === "json" ? "json" : format === "text" ? "txt" : "csv";

  useEffect(() => { setPath(d.path); }, [d.path]);

  // Text uses a STRING input, CSV/JSON a FRAME input; crossing that boundary swaps the
  // `in` socket in place ([[B11]] maximalMerge), cables pruned first.
  async function pickFormat(next: WriteFormat) {
    if (next === format) return;
    const willRetype = (format === "text") !== (next === "text");
    if (willRetype) await dropInputCables(d.id, ["in"]);
    d.setFormat(next);
    setFormat(next);
    const view = getOwningView(d.id);
    if (view) await view.rerenderNode(d.id);
    d.edited(); await processGraph();
  }

  function commitPath() {
    const next = path.trim();
    setPath(next);
    if (next === d.path) return;
    d.path = next;
    notifyGraphChanged();
  }

  async function browse() {
    const before = d.path;
    await d.browse();
    setPath(d.path);
    if (d.path !== before) notifyGraphChanged();
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
        <div className="sol-conn__line">
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
        <FrameDisplay frame={previewed(() => d.cachedFrame)} label={d.label} />
      </div>
    </NodeShell>
  );
}

type WriteObsidianData = WriteObsidianNodeType & {
  subfolder: string; mode: ObsidianWriteMode; stamp: boolean; target: WriteObsidianTarget;
  addMissing: boolean; writeBase: boolean; enabled: boolean; status: string; statusMessage: string; lastWritten: string;
  stringLiterals: Record<string, string>;
  cachedPlan: unknown;
  run(): Promise<void>; preview(): Promise<void>;
  resolveMode(): "note" | "properties";
  renderedTarget(): { name: string; subfolder: string };
};

const stopPtr = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };

export function WriteObsidianComponent({ data, emit }: NodeProps<WriteObsidianNodeType>) {
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get); // Auto mode follows the wired input
  const d = data as unknown as WriteObsidianData;
  const [target, setTarget] = useState(d.target);
  const [subfolder, setSubfolder] = useState(d.subfolder);
  const [mode, setMode] = useState<ObsidianWriteMode>(d.mode);
  const [stamp, setStamp] = useState(d.stamp);
  const [addMissing, setAddMissing] = useState(d.addMissing);
  const [writeBase, setWriteBase] = useState(d.writeBase);
  const [armed, setArmed] = useState(d.enabled);
  const [status, setStatus] = useState(d.status);
  const [message, setMessage] = useState(d.statusMessage);
  const vaultFs = hasFs();
  const vault = useSyncExternalStore(settingsStore.subscribe, () => getVaultRoot());

  const activeMode = d.resolveMode(); // "note" | "properties"
  const inputKeys = activeMode === "properties" ? ["in", "rows", "keys"] : ["in", "path", "rows"];

  function pickTarget(v: WriteObsidianTarget) { d.target = v; setTarget(v); void getOwningView(d.id)?.rerenderNode(d.id); d.edited(); void processGraph(); }
  function pickSubfolder(v: string) { d.subfolder = v; setSubfolder(v); notifyGraphChanged(); }
  function pickMode(v: ObsidianWriteMode) { d.mode = v; setMode(v); notifyGraphChanged(); }
  function toggleArmed() { d.enabled = !d.enabled; setArmed(d.enabled); }
  function toggleStamp() { d.stamp = !d.stamp; setStamp(d.stamp); notifyGraphChanged(); }
  function toggleAddMissing() { d.addMissing = !d.addMissing; setAddMissing(d.addMissing); d.edited(); void processGraph(); }
  function toggleWriteBase() { d.writeBase = !d.writeBase; setWriteBase(d.writeBase); notifyGraphChanged(); }

  // Picking a note fills the folder select + the `path` literal (its bare name), so the
  // two controls stay in sync; a wired `path` overrides both.
  function pickFile(rel: string) {
    const noMd = rel.replace(/\.md$/i, "");
    const slash = noMd.lastIndexOf("/");
    const folder = slash >= 0 ? noMd.slice(0, slash) : "";
    const base = slash >= 0 ? noMd.slice(slash + 1) : noMd;
    d.subfolder = folder; setSubfolder(folder);
    (d.stringLiterals ??= {}).path = base;
    void getOwningView(d.id)?.rerenderNode(d.id);
    d.edited(); void processGraph();
  }

  async function preview() {
    setStatus("previewing");
    await d.preview();
    setStatus(d.status); setMessage(d.statusMessage);
    d.edited(); void processGraph();
  }
  async function run() {
    setStatus("writing");
    await d.run();
    setStatus(d.status); setMessage(d.statusMessage);
  }

  const rtarget = d.renderedTarget();
  const renderedName = rtarget.name || d.label || "note";
  const doc = d.cachedDoc;
  const docPreview = isDocumentValue(doc)
    ? `${doc.frontmatter ? "note" : "report"} · ${doc.body.length} char${doc.body.length === 1 ? "" : "s"}`
    : null;
  const hasPlanRows = isFrameValue(d.cachedPlan) && d.cachedPlan.columns[0].values.length > 0;
  const busy = status === "writing" || status === "previewing";
  const canRun = activeMode === "properties" ? hasPlanRows : renderedName.trim() !== "";

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={inputKeys} />
      <div className="sol-conn">
        {!vaultFs && <div className="sol-conn__note">Writing to a vault is available in the desktop app only.</div>}
        {vaultFs && vault.trim() === "" && <div className="sol-conn__note">Set the Obsidian vault folder in Settings.</div>}
        <SegToggle value={target} options={OBSIDIAN_TARGET_OPTIONS} onChange={pickTarget} />

        {activeMode === "note" ? (
          <>
            <PickField
              value={[d.subfolder, d.stringLiterals?.path].filter(Boolean).join("/")}
              placeholder="Browse the vault for a note…"
              title="Choose a vault note to write to"
              disabled={!vaultFs}
              onPick={() => void chooseFile({
                title: "Choose a note to write to",
                root: vault,
                extensions: ["md"],
                current: d.stringLiterals?.path ? `${[d.subfolder, d.stringLiterals.path].filter(Boolean).join("/")}.md` : undefined,
                list: () => listVaultMarkdownFiles(vault),
                empty: "No notes in the vault",
                blocked: vault.trim() === "" ? "Set the Obsidian vault folder in Settings." : undefined,
              }).then((rel) => { if (rel) pickFile(rel); })}
            />
            {rtarget.name && <div className="sol-conn__note" title="Where Run writes">{[rtarget.subfolder, renderedName].filter(Boolean).join("/")}.md</div>}
            <SegToggle value={mode} options={OBSIDIAN_WRITE_MODE_OPTIONS} onChange={pickMode} />
            <label className="sol-write__armed" title="Add a solenoid: link on the note + a Solenoid/<graph> stub note" {...stopPtr}>
              <input type="checkbox" checked={stamp} onChange={toggleStamp} />
              Link to graph
            </label>
            {stamp && <div className="sol-conn__note" title="Stub note this write adds a solenoid: link to">+ {stubRelPath(documentStore.currentName())}</div>}
            <PickField
              value={subfolder}
              placeholder="Vault root"
              title="The folder the note is written in"
              disabled={!vaultFs}
              onPick={() => void chooseFile({
                title: "Choose a folder to write in",
                root: vault,
                kind: "folder",
                current: subfolder || undefined,
                rootLabel: "Vault root",
                list: () => listVaultFolders(vault),
                blocked: vault.trim() === "" ? "Set the Obsidian vault folder in Settings." : undefined,
              }).then((rel) => { if (rel !== null) pickSubfolder(rel); })}
            />
          </>
        ) : (
          <>
            <label className="sol-write__armed" title="Add + register a property the note doesn't have yet" {...stopPtr}>
              <input type="checkbox" checked={addMissing} onChange={toggleAddMissing} />
              Add missing
            </label>
            <label className="sol-write__armed" title="Also write a <node>.base view beside the notes" {...stopPtr}>
              <input type="checkbox" checked={writeBase} onChange={toggleWriteBase} />
              Write .base
            </label>
          </>
        )}

        <div className="sol-write__row">
          <button
            type="button" className="sol-write__run"
            disabled={!vaultFs || vault.trim() === "" || busy}
            title="Read the vault and report what Run would do"
            onClick={(e) => { e.stopPropagation(); void preview(); }}
            {...stopPtr}
          >
            Preview
          </button>
          <label className="sol-write__armed" {...stopPtr}>
            <input type="checkbox" checked={armed} disabled={!vaultFs} onChange={toggleArmed} />
            Armed
          </label>
          <button
            type="button" className="sol-write__run"
            disabled={!vaultFs || !armed || !canRun || vault.trim() === "" || busy}
            title="Write to the vault now"
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
        {activeMode === "note" && d.lastWritten && obsidianOpenUrl(vault, d.lastWritten) && (
          <button
            type="button" className="sol-write__run" title="Open the note in Obsidian"
            onClick={(e) => { e.stopPropagation(); void openExternal(obsidianOpenUrl(vault, d.lastWritten)!); }}
            {...stopPtr}
          >
            Open in Obsidian
          </button>
        )}
        {activeMode === "note" && docPreview && <div className="sol-conn__note">{docPreview}</div>}
        {activeMode === "properties" && <FrameDisplay frame={d.cachedPlan as never} label={d.label || "Write to Obsidian"} />}
        {activeMode === "note" && (
          <div className={`solenoid-node__collapsed-only solenoid-node__display-value solenoid-node__display-value--chip${isDocumentValue(doc) ? "" : " solenoid-node__display-value--empty"}`}>
            {isDocumentValue(doc) ? <DocumentChip value={doc} size="sm" /> : "—"}
          </div>
        )}
      </div>
    </NodeShell>
  );
}

// ─── WRITE TASKS ────────────────────────────────────────────────────────────────
// Preview reads, Run writes through the TaskNotes API.
export function WriteTasksComponent({ data, emit }: NodeProps<WriteTasksNodeType>) {
  const [armed, setArmed] = useState(data.enabled);
  const [status, setStatus] = useState<string>(data.status);
  const [message, setMessage] = useState(data.statusMessage);
  function toggleArmed() { data.enabled = !data.enabled; setArmed(data.enabled); }
  async function preview() {
    setStatus("previewing");
    await data.preview();
    setStatus(data.status); setMessage(data.statusMessage);
    data.edited(); void processGraph();
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
        <FrameDisplay frame={previewed(() => data.cachedPlan)} label={data.label || "Write Tasks"} />
      </div>
    </NodeShell>
  );
}
