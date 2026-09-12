import { ClassicPreset } from "rete";
import { documentIn, strIn, strOut, cubeIn, frameOut, readInput } from "./shared";
import { formatDateSerial } from "./dateSerial";
import type { ObsidianWriteMode } from "../obsidianWrite";
import { NoteNode } from "./annotation";
import { type FrontmatterFieldType } from "../noteFrontmatter";
import { isDocumentValue, type DocumentValue } from "../documentValue";
import { isSolError, type SolError } from "../errorValue";
import { hasFs, readVaultFile, writeTextFilePath, joinPath, listMarkdownFiles, readFileText } from "../fileBridge";
import { settingsStore } from "../settingsStore";
import { trackInflight, scheduleConnectionRecalc } from "../connectionStore";
import { planPropertyWrites, propertyPlanFrame, resolveKey, resolveBody, patchFrontmatter, setBody, writableKeys, NOTE_BODY, type PlanRow } from "../frontmatterPatch";
import { buildBaseView, baseRelPath } from "../baseView";
import { mdbaseSchemaFor, validateAgainst, parseMdbaseCollection, type MdbaseCollection, type PropConstraint } from "../mdbaseTypes";
import { isCubeValue, type CubeValue, type FrameValue } from "../frame";
import { type Shape } from "../frameShape";

import { getOwningEditor, getOwningView } from "../activeGraph";
// obsidianWrite is imported lazily INSIDE run(): pulling its subtree eagerly through
// the rete-nodes barrel creates an init cycle (…→ documentStore → persistence →
// nodeCatalog → rete-nodes) that leaves catalog metadata undefined at eval time.

// The `.md` write fires ONLY from the Run button, and `enabled` is kept OUT of
// copyPaste's persistence whitelist so every load/paste/restore starts disarmed.

export type ObsidianWriteStatus = "idle" | "writing" | "previewing" | "ok" | "error";
export type WriteObsidianTarget = "auto" | "note" | "properties";

export const OBSIDIAN_WRITE_MODE_OPTIONS: ReadonlyArray<{ value: ObsidianWriteMode; label: string; title: string }> = [
  { value: "overwrite", label: "Overwrite", title: "The note becomes the document" },
  { value: "append",    label: "Append",    title: "The document is added at the end of the note" },
  { value: "block",     label: "Block",     title: "The writer owns one hidden-marker block in the note; the rest of the note is yours" },
];

export const OBSIDIAN_TARGET_OPTIONS: ReadonlyArray<{ value: WriteObsidianTarget; label: string; title: string }> = [
  { value: "auto",       label: "Auto",       title: "Follow the wired input: a Document writes a note, rows write properties" },
  { value: "note",       label: "Note",       title: "Write the wired Document as one note" },
  { value: "properties", label: "Properties", title: "Write the rows' columns as each note's frontmatter, a note-body column as its body" },
];

/** The notes named in a cube (its path + name columns), so a string cell matching one
 *  serializes as a `[[link]]`. */
function noteNamesOf(cube: CubeValue): Set<string> {
  const names = new Set<string>();
  for (const c of cube.columns) {
    if (c.name !== "path" && c.name !== "name") continue;
    for (const cell of c.cells) if (typeof cell === "string" && cell) names.add(cell);
  }
  return names;
}

/** A cube column's Obsidian property-type name (for the .obsidian/types.json registration). */
function obsidianTypeName(cube: CubeValue, key: string): string {
  const col = cube.columns.find((c) => c.name === key);
  if (col && col.cells.some((cell) => Array.isArray(cell))) return "multitext";
  switch (col?.type) {
    case "number":  return "number";
    case "logical": return "checkbox";
    case "date":    return "date";
    default:        return "text";
  }
}

/** Now as a local-wall-clock Excel serial (date + time of day). */
function nowSerial(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569;
}

// Write to Obsidian is ONE vault sink (2026-09-11 merge): a wired Document writes a
// note (overwrite / append / block), a wired cube of rows writes properties (each
// column a frontmatter key, a `note-body` column the body). The Target dropdown picks,
// or Auto follows the wired input. The write fires ONLY from Run, and `enabled` is out
// of copyPaste's persistence whitelist so every load starts disarmed.
export class WriteObsidianNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "The Document to write as a note (Note target). Wiring never writes; Run does, and the node loads disarmed.",
    path: "The note to write: a vault-relative path or a bare name (no .md). Wire a path from a Vault Folder row, or pick one with Browse. A leading folder overrides the subfolder.",
    rows: "The rows to write as properties (Properties target): a cube with a `path` column naming each note; a `note-body` column writes each note's body, every other column its frontmatter. Wiring never writes.",
    plan: "Properties target: one row per note and property, with the note's current value, the value to write, and the action Preview resolves. Empty in the Note target.",
  };
  label: string;
  /** Vault-relative destination subfolder ("" = the vault root). A leading folder on
   *  the `path` prepends to this. (Note target.) */
  subfolder: string;
  /** overwrite | append | block (a managed marker block the writer owns). (Note target.) */
  mode: ObsidianWriteMode;
  /** Link each written note back to a `Solenoid/<doc>` stub note (bundle D). Opt-in. (Note target.) */
  stamp: boolean;
  /** Which behavior runs: auto (by the wired input), or forced to note / properties. */
  target: WriteObsidianTarget;
  /** Append + register a key the note doesn't have yet. (Properties target.) */
  addMissing = true;
  /** Also write a `<node>.base` beside the notes. (Properties target.) */
  writeBase = false;
  /** Inline literals: `path` (the Note target) + `keys` (Properties: columns to write). */
  stringLiterals: Record<string, string> = { path: "", keys: "" };
  /** Never persisted (sinkRunButtonOnly) — always false on a fresh construction. */
  enabled = false;
  cachedDoc: DocumentValue | SolError | null = null;
  /** The path the last data() resolved (the wired `path`, else its literal). */
  private resolvedPath = "";
  cachedCube: CubeValue | SolError | null = null;
  cachedPlan: FrameValue | SolError | null = null;
  private planRows: PlanRow[] = [];
  private _mdbaseCache = new Map<string, MdbaseCollection | null>();
  status: ObsidianWriteStatus = "idle";
  statusMessage = "";
  /** The vault-relative path of the last note this card wrote (transient; Open in Obsidian). */
  lastWritten = "";
  width = 262; height = 280;

  /** The `plan` output's columns (Properties target), for type propagation. */
  frameShape(): Shape {
    return { columns: [
      { name: "path", type: "string" }, { name: "key", type: "string" },
      { name: "before", type: "string" }, { name: "after", type: "string" }, { name: "action", type: "string" },
    ] };
  }

  constructor(init?: { label?: string; subfolder?: string; mode?: ObsidianWriteMode; stamp?: boolean; target?: WriteObsidianTarget; addMissing?: boolean; writeBase?: boolean }) {
    super("WriteObsidian");
    this.label = init?.label ?? "Write to Obsidian";
    this.subfolder = init?.subfolder ?? "";
    this.mode = init?.mode === "append" || init?.mode === "block" ? init.mode : "overwrite";
    this.stamp = init?.stamp === true;
    this.target = init?.target === "note" || init?.target === "properties" ? init.target : "auto";
    if (init?.addMissing === false) this.addMissing = false;
    if (init?.writeBase) this.writeBase = true;
    this.addInput("in", documentIn("Document"));
    this.addInput("path", strIn("Path"));
    this.addInput("rows", cubeIn("Rows"));
    this.addOutput("plan", frameOut("Plan"));
  }

  /** Which behavior runs: the dropdown, else the wired input (a cube → properties). */
  resolveMode(): "note" | "properties" {
    if (this.target === "note") return "note";
    if (this.target === "properties") return "properties";
    return isCubeValue(this.cachedCube) && !isDocumentValue(this.cachedDoc) ? "properties" : "note";
  }

  // Caches + plans only; never touches disk.
  data(inputs: { in?: (DocumentValue | SolError)[]; path?: (string | null)[]; rows?: (CubeValue | SolError | null)[] }): { plan: FrameValue | SolError | null } {
    this.cachedDoc = inputs.in?.[0] ?? null;
    this.resolvedPath = (readInput(inputs.path, this.stringLiterals?.path ?? "") ?? "").trim();
    const raw = inputs.rows?.[0] ?? null;
    if (raw !== this.cachedCube) { // re-plan only when the cube changes (Preview mutates planRows)
      this.cachedCube = raw;
      if (isSolError(raw)) { this.cachedPlan = raw; this.planRows = []; }
      else if (!isCubeValue(raw)) { this.cachedPlan = null; this.planRows = []; }
      else { this.planRows = planPropertyWrites(raw, this.stringLiterals.keys ?? "", noteNamesOf(raw)); this.cachedPlan = propertyPlanFrame(this.planRows); }
    }
    return { plan: this.cachedPlan };
  }

  /** The note name + subfolder the current `path` resolves to (Note target: the card's
   *  preview and what Run writes). A `folder/name` path splits: the last segment is the
   *  name, the rest prepends to the node's subfolder. */
  renderedTarget(): { name: string; subfolder: string } {
    const parts = this.resolvedPath.split("/").filter(Boolean);
    const name = (parts.pop() ?? "").replace(/\.md$/i, "").trim();
    const subfolder = [this.subfolder.trim().replace(/^\/+|\/+$/g, ""), ...parts].filter(Boolean).join("/");
    return { name, subfolder };
  }

  /** ref name → source node id, walked from this sink's `in` through the producer's
   *  ref inputs. Used only to rasterize a chart ref, which needs its live SVG. */
  private refSources(): Map<string, string> {
    const out = new Map<string, string>();
    const ed = getOwningEditor(this.id);
    if (!ed) return out;
    const conns = ed.getConnections();
    const toMe = conns.find((c) => c.target === this.id && c.targetInput === "in");
    if (!toMe) return out;
    for (const c of conns) {
      if (c.target === toMe.source) out.set(c.targetInput, c.source);
    }
    return out;
  }

  /** Call ONLY from the Run button (or headless --run); re-entrancy-guarded, desktop only. */
  async run(): Promise<void> {
    if (this.status === "writing" || this.status === "previewing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled. Arm it first."; return; }
    if (!hasFs()) { this.status = "error"; this.statusMessage = "Writing needs the desktop app"; return; }
    const vault = settingsStore.get("obsidianVault").trim();
    if (!vault) { this.status = "error"; this.statusMessage = "Set the vault folder in Settings"; return; }
    if (this.resolveMode() === "properties") { await this.runProperties(vault); return; }
    await this.runNote(vault);
  }

  /** Preview: Properties resolves the plan against the notes; Note reports the target action. */
  async preview(): Promise<void> {
    if (this.status === "writing" || this.status === "previewing") return;
    if (!hasFs()) { this.status = "error"; this.statusMessage = "Preview needs the desktop app"; return; }
    const vault = settingsStore.get("obsidianVault").trim();
    if (!vault) { this.status = "error"; this.statusMessage = "Set the vault folder in Settings"; return; }
    if (this.resolveMode() === "properties") { await this.previewProperties(vault); return; }
    await this.previewNote(vault);
  }

  // ─── NOTE target ──────────────────────────────────────────────────────────────
  private async previewNote(vault: string): Promise<void> {
    const { name, subfolder } = this.renderedTarget();
    const finalName = (name || this.label || "note").replace(/\.md$/i, "").trim();
    if (!finalName) { this.status = "error"; this.statusMessage = "Name the note"; return; }
    const doc = this.cachedDoc;
    if (isSolError(doc)) { this.status = "error"; this.statusMessage = doc.code; return; }
    if (!isDocumentValue(doc)) { this.status = "error"; this.statusMessage = "Nothing to write. Connect a Note or Report."; return; }
    const rel = `${[subfolder, finalName].filter(Boolean).join("/")}.md`;
    this.status = "previewing";
    try {
      let existing: string | null = null;
      try { existing = await readVaultFile(vault, rel); } catch { existing = null; }
      const verb = existing === null ? "Create" : this.mode === "overwrite" ? "Overwrite" : this.mode === "append" ? "Append to" : "Rewrite the block in";
      const size = this.docBodyLength();
      this.status = "idle";
      this.statusMessage = existing === null
        ? `${verb} ${rel} (${size} char${size === 1 ? "" : "s"})`
        : `${verb} ${rel} (${existing.length} char${existing.length === 1 ? "" : "s"} on disk)`;
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }

  private docBodyLength(): number {
    return isDocumentValue(this.cachedDoc) ? this.cachedDoc.body.length : 0;
  }

  private async runNote(vault: string): Promise<void> {
    const target = this.renderedTarget();
    // A single-page write needs a name; a batch names each note by its page, so a blank
    // name still writes (the label is the block name only).
    const name = (target.name || this.label || "note").replace(/\.md$/i, "").trim();
    const subfolder = target.subfolder;
    if (!name) { this.status = "error"; this.statusMessage = "Name the note"; return; }
    const doc = this.cachedDoc;
    if (isSolError(doc)) { this.status = "error"; this.statusMessage = doc.code; return; }
    if (!isDocumentValue(doc)) { this.status = "error"; this.statusMessage = "Nothing to write. Connect a Note or Report."; return; }
    this.status = "writing";
    try {
      const { writeDocumentToVault } = await import("../obsidianWrite");
      const res = await writeDocumentToVault(doc, {
        vault, subfolder, assetSubfolder: settingsStore.get("obsidianAssetSubfolder"),
        name, refSources: this.refSources(), mode: this.mode, blockName: this.label,
      });
      this.status = "ok";
      this.lastWritten = res.file;
      // A batch that hit the page cap carries the true record count; say "500 of N".
      const count = doc.total && doc.total > res.pages ? `${res.pages} of ${doc.total}` : `${res.pages}`;
      const what = res.pages > 1 ? `${count} notes${subfolder ? ` in ${subfolder}` : ""}` : res.file;
      this.statusMessage = res.assets > 0 ? `Wrote ${what} + ${res.assets} asset${res.assets === 1 ? "" : "s"}` : `Wrote ${what}`;
      // D: link the note back to a Solenoid/<doc> stub note (best effort). A batch stamps nothing.
      if (this.stamp && res.pages === 1) {
        try {
          const { documentStore } = await import("../documentStore");
          const docName = documentStore.currentName();
          const d = new Date();
          const now = formatDateSerial(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569, "YYYY-MM-DDTHH:mm:ss");
          const { stubLink, stubRelPath, mergeStub } = await import("../graphStub");
          const { ensureDir } = await import("../fileBridge");
          const noteText = await readVaultFile(vault, res.file);
          const patched = patchFrontmatter(noteText, { solenoid: stubLink(docName, this.label) });
          await writeTextFilePath(await joinPath(vault, ...res.file.split("/")), patched.text);
          let existing: string | null = null;
          try { existing = await readVaultFile(vault, stubRelPath(docName)); } catch { existing = null; }
          await ensureDir(await joinPath(vault, "Solenoid"));
          await writeTextFilePath(await joinPath(vault, ...stubRelPath(docName).split("/")), mergeStub(existing, docName, this.label, res.file, now));
        } catch { /* stamping never fails the write */ }
      }
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }

  // ─── PROPERTIES target ──────────────────────────────────────────────────────────
  private byPath(): Map<string, PlanRow[]> {
    const m = new Map<string, PlanRow[]>();
    for (const r of this.planRows) { const list = m.get(r.path) ?? []; list.push(r); m.set(r.path, list); }
    return m;
  }

  private async loadCollection(vault: string, folder: string): Promise<MdbaseCollection | null> {
    try {
      const yaml = await readVaultFile(vault, folder ? `${folder}/mdbase.yaml` : "mdbase.yaml");
      let types: string[] = [];
      try {
        const typesDir = folder ? await joinPath(vault, ...folder.split("/"), "_types") : await joinPath(vault, "_types");
        const names = await listMarkdownFiles(typesDir);
        types = await Promise.all(names.map((n) => readFileText(typesDir, n)));
      } catch { types = []; }
      return parseMdbaseCollection(yaml, types);
    } catch { return null; }
  }

  private async schemaFor(vault: string, relPath: string): Promise<{ constraints: Record<string, PropConstraint>; required: string[] } | null> {
    const parts = relPath.split("/");
    parts.pop();
    for (let i = parts.length; i >= 0; i--) {
      const folder = parts.slice(0, i).join("/");
      if (!this._mdbaseCache.has(folder)) this._mdbaseCache.set(folder, await this.loadCollection(vault, folder));
      const coll = this._mdbaseCache.get(folder)!;
      if (coll) { const collRel = folder ? relPath.slice(folder.length + 1) : relPath; const sch = mdbaseSchemaFor(coll, collRel); if (sch) return sch; }
    }
    return null;
  }

  private validateRows(rows: PlanRow[], sch: { constraints: Record<string, PropConstraint>; required: string[] } | null): void {
    if (!sch) return;
    for (const r of rows) {
      if (r.action === "refused" || r.action === "unreadable" || r.key === NOTE_BODY) continue;
      if (sch.required.includes(r.key) && r.value === null) { r.action = "refused"; r.reason = "required, can't be blank"; continue; }
      const c = sch.constraints[r.key];
      if (c) { const reason = validateAgainst(r.value, c); if (reason) { r.action = "refused"; r.reason = `mdbase: ${reason}`; } }
    }
  }

  private async previewProperties(vault: string): Promise<void> {
    if (!this.planRows.length) { this.status = "error"; this.statusMessage = "Nothing to write. Connect rows."; return; }
    this.status = "previewing";
    this._mdbaseCache.clear();
    try {
      for (const [p, rows] of this.byPath()) {
        let text: string;
        try { text = await readVaultFile(vault, p); }
        catch { for (const r of rows) { r.action = "unreadable"; r.before = ""; r.reason = undefined; } continue; }
        for (const r of rows) {
          if (r.key === NOTE_BODY) { const { action, before } = resolveBody(text, r.value as string); r.before = before; r.action = action; r.reason = undefined; continue; }
          const { action, before } = resolveKey(text, r.key, r.value);
          r.before = before;
          r.action = action === "add" && !this.addMissing ? "unchanged" : action;
          r.reason = action === "refused" ? "nested block" : undefined;
        }
        this.validateRows(rows, await this.schemaFor(vault, p));
      }
      this.cachedPlan = propertyPlanFrame(this.planRows);
      const n = (a: string) => this.planRows.filter((r) => r.action === a).length;
      this.status = "idle";
      this.statusMessage = `Preview: ${n("add")} to add, ${n("update")} to update, ${n("unchanged")} unchanged` +
        `${n("refused") ? `, ${n("refused")} refused` : ""}${n("unreadable") ? `, ${n("unreadable")} unreadable` : ""}`;
    } catch (e) { this.status = "error"; this.statusMessage = e instanceof Error ? e.message : String(e); }
  }

  private async runProperties(vault: string): Promise<void> {
    if (isSolError(this.cachedCube)) { this.status = "error"; this.statusMessage = this.cachedCube.code; return; }
    if (!this.planRows.length) { this.status = "error"; this.statusMessage = "Nothing to write. Connect rows."; return; }
    this.status = "writing";
    this._mdbaseCache.clear();
    let wrote = 0, changed = 0, failed = 0;
    const failures: string[] = [];
    const newTypes = new Map<string, string>();
    const cube = isCubeValue(this.cachedCube) ? this.cachedCube : null;
    try {
      for (const [p, rows] of this.byPath()) {
        let text: string;
        try { text = await readVaultFile(vault, p); }
        catch { failed++; if (failures.length < 3) failures.push(`${p}: unreadable`); continue; }
        const sch = await this.schemaFor(vault, p);
        const patch: Record<string, PlanRow["value"]> = {};
        let touched = 0;
        let newBody: string | null = null;
        for (const r of rows) {
          if (r.key === NOTE_BODY) { if (resolveBody(text, r.value as string).action === "update") { newBody = r.value as string; touched++; } continue; }
          const { action } = resolveKey(text, r.key, r.value);
          if (action === "refused") continue;
          if (action === "add" && !this.addMissing) continue;
          if (action === "unchanged") continue;
          if (sch) {
            if (sch.required.includes(r.key) && r.value === null) continue;
            const c = sch.constraints[r.key];
            if (c && validateAgainst(r.value, c)) continue;
          }
          patch[r.key] = r.value;
          touched++;
          if (action === "add" && cube) newTypes.set(r.key, obsidianTypeName(cube, r.key));
        }
        for (const stampKey of ["dateModified", "updated"]) {
          const cur = resolveKey(text, stampKey, "");
          if (cur.action !== "add") patch[stampKey] = formatDateSerial(nowSerial(), /^\d{4}-\d{2}-\d{2}$/.test(cur.before) ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
        }
        if (touched === 0) continue;
        let out = Object.keys(patch).length ? patchFrontmatter(text, patch).text : text;
        if (newBody !== null) out = setBody(out, newBody); // the note-body column → the body
        try { await writeTextFilePath(await joinPath(vault, ...p.split("/")), out); wrote++; changed += touched; }
        catch (e) { failed++; if (failures.length < 3) failures.push(`${p}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (this.addMissing && newTypes.size > 0) await this.registerTypes(vault, newTypes);
      if (this.writeBase && wrote > 0 && cube) {
        try {
          const folders = new Set(this.planRows.map((r) => (r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "")));
          const folder = folders.size === 1 ? [...folders][0] : "";
          await writeTextFilePath(await joinPath(vault, ...baseRelPath(folder, this.label).split("/")), buildBaseView(folder, writableKeys(cube, this.stringLiterals.keys ?? ""), this.label));
        } catch { /* the .base companion is a convenience, never a write failure */ }
      }
      this.status = failed ? "error" : "ok";
      this.statusMessage = `${changed} change${changed === 1 ? "" : "s"} across ${wrote} note${wrote === 1 ? "" : "s"}` +
        `${failed ? `, ${failed} failed — ${failures.join("; ")}` : ""}`;
    } catch (e) { this.status = "error"; this.statusMessage = e instanceof Error ? e.message : String(e); }
  }

  private async registerTypes(vault: string, newTypes: Map<string, string>): Promise<void> {
    try {
      let types: Record<string, string> = {};
      try { const parsed = JSON.parse(await readVaultFile(vault, ".obsidian/types.json")) as { types?: Record<string, string> }; types = parsed.types ?? {}; } catch { /* no file yet */ }
      let added = false;
      for (const [k, t] of newTypes) if (!(k in types)) { types[k] = t; added = true; }
      if (!added) return;
      await writeTextFilePath(await joinPath(vault, ".obsidian", "types.json"), JSON.stringify({ types }, null, 2) + "\n");
    } catch { /* registration is a convenience, never a write failure */ }
  }
}

// It IS a Note (extends NoteNode), reusing the frontmatter-socket machinery and
// adding only a source path + read-only body, which persists so a loaded doc shows
// the imported content on web too. Beyond a Note it exposes the source `path` as a
// wireable value — out (index the imported note against a Vault Folder cube) and in
// (drive which note loads from a value); the human title renders in the card body.

const IMPORT_RESERVED: ReadonlySet<string> = new Set(["document", "path"]);

export class ImportObsidianNode extends NoteNode {
  static socketDocs: Record<string, string> = {
    document: "Carries the note's full text, frontmatter included, for a document sink such as Write to Obsidian.",
    path: "The source note's vault-relative path. Wire it out to join or index against a Vault Folder cube; wire a path in to load that note instead of the picked one.",
  };
  /** Vault-relative path of the source `.md` file ("" until one is picked). */
  fileName: string;
  /** Minutes between automatic reloads from the vault, 0 = off — the component runs the timer. */
  refreshMinutes: number;

  constructor(init?: {
    label?: string; body?: string; color?: string; width?: number; height?: number;
    collapsed?: boolean; fieldTypes?: Record<string, FrontmatterFieldType>; fileName?: string; refreshMinutes?: number;
  }) {
    super({
      label: init?.label ?? "Import Obsidian Note",
      body: init?.body ?? "",
      color: init?.color ?? "violet",
      width: init?.width ?? 345,
      height: init?.height ?? 150,
      collapsed: init?.collapsed,
      fieldTypes: init?.fieldTypes,
    });
    this.fileName = init?.fileName ?? "";
    this.refreshMinutes = Math.max(0, Math.round(init?.refreshMinutes ?? 0));
    // The wireable identity: pick a note by hand, OR drive `path` from a cube row.
    this.addInput("path", strIn("Path"));
    this.addOutput("path", strOut("Path"));
  }

  protected reservedOutputs(): ReadonlySet<string> { return IMPORT_RESERVED; }

  /** The path a wired input last drove a load for — guards a reload loop once
   *  `fileName` catches up (the VaultFolder `_lastKey` pattern). */
  private _wiredPath = "";

  // Emit the source path beside the fields + document, so downstream can index the
  // imported note. A wired `path` loads that note in the background (desktop only),
  // replacing the picked file; unwired, the in-card picker is the source.
  data(inputs?: { path?: (string | null)[] }): ReturnType<NoteNode["data"]> {
    const wired = (readInput(inputs?.path, "") ?? "").trim();
    // Dedupe on the RAW wired value (not fileName, which gains a `.md`): a stable input
    // loads once, an unwire resets so a re-wire loads again.
    if (!wired) {
      this._wiredPath = "";
    } else if (wired !== this._wiredPath && hasFs()) {
      this._wiredPath = wired;
      void trackInflight(this.loadFromWire(wired));
    }
    const base = super.data();
    return base instanceof Promise
      ? base.then((r) => ({ ...r, path: this.fileName }))
      : { ...base, path: this.fileName };
  }

  /** Read the wired note from the vault and adopt it: body, source path (`.md`
   *  included, matching a Vault Folder cube's `path`), name, and the frontmatter
   *  sockets, then recompute. Mirrors the component's picker commit. */
  private async loadFromWire(path: string): Promise<void> {
    try {
      const vault = settingsStore.get("obsidianVault").trim();
      const { readVaultFile, listVaultMarkdownFiles } = await import("../fileBridge");
      // Resolve a full vault-relative path OR a bare note name — Obsidian resolves
      // `[[Name]]` from anywhere in the vault, case-insensitively.
      const withMd = /\.md$/i.test(path) ? path : `${path}.md`;
      const files = await listVaultMarkdownFiles(vault);
      const base = (path.split("/").pop() ?? path).replace(/\.md$/i, "").toLowerCase();
      const rel = files.includes(withMd) ? withMd
        : files.find((f) => (f.split("/").pop() ?? f).replace(/\.md$/i, "").toLowerCase() === base) ?? null;
      if (!rel || rel === this.fileName) return; // not found, or already loaded — keep the current body
      const content = await readVaultFile(vault, rel);
      this.body = content;
      this.fileName = rel;
      if (this.label === "Import Obsidian Note" || this.label.trim() === "") {
        this.label = (rel.split("/").pop() ?? rel).replace(/\.md$/i, "");
      }
      const { removed, retyped } = this.syncFields();
      const { dropStrandedFrontmatterCables } = await import("../noteFrontmatterSync");
      await dropStrandedFrontmatterCables(this.id, removed, retyped);
      await getOwningView(this.id)?.rerenderNode(this.id);
      scheduleConnectionRecalc();
    } catch { /* unreadable (moved / renamed / off-desktop) — keep the current body */ }
  }
}
