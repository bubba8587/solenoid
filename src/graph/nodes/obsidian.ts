// [[C101]] onePatchPath, [[C38]] sinkRunButtonOnly
import { ClassicPreset } from "rete";
import { documentIn, strIn, strOut, cubeIn, frameOut, readInput } from "./shared";
import { formatDateSerial } from "./dateSerial";
import type { ObsidianWriteMode } from "../obsidianWrite";
import { NoteNode } from "./annotation";
import { type FrontmatterFieldType } from "../noteFrontmatter";
import { isDocumentValue, type DocumentValue } from "../documentValue";
import { isSolError, type SolError } from "../errorValue";
import { hasFs, readVaultFile, writeTextFilePath, joinPath, listMarkdownFiles, readFileText, pathExists } from "../fileBridge";
import { settingsStore } from "../settingsStore";
import { getVaultRoot, isDemoVaultPath } from "../demoVault";
import { connectionStore, trackInflight, scheduleConnectionRecalc } from "../connectionStore";
import { planPropertyWrites, propertyPlanFrame, resolveKey, resolveBody, patchFrontmatter, setBody, writableKeys, frontmatterTags, displayValue, NOTE_BODY, type PlanRow } from "../frontmatterPatch";
import { buildBaseView, baseRelPath } from "../baseView";
import { mdbaseSchemaFor, validateAgainst, parseMdbaseCollection, type MdbaseCollection, type PropConstraint } from "../mdbaseTypes";
import { isCubeValue, isFrameValue, type CubeValue, type FrameValue } from "../frame";
import { type Shape } from "../frameShape";

import { getOwningEditor, getOwningView } from "../activeGraph";
// obsidianWrite is imported lazily inside run(), because an eager import closes an init cycle through the node barrel.

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

function noteNamesOf(cube: CubeValue): Set<string> {
  const names = new Set<string>();
  for (const c of cube.columns) {
    if (c.name !== "path" && c.name !== "name") continue;
    for (const cell of c.cells) if (typeof cell === "string" && cell) names.add(cell);
  }
  return names;
}

/** Null when Obsidian has no type for it (rows, a matrix): registering Text there would only raise its mismatch warning. */
export function obsidianTypeName(cube: CubeValue, key: string): string | null {
  const col = cube.columns.find((c) => c.name === key);
  if (col?.cells.some((cell) => isFrameValue(cell) || isCubeValue(cell) || (Array.isArray(cell) && cell.some(Array.isArray)))) return null;
  if (col && col.cells.some((cell) => Array.isArray(cell))) return "multitext";
  switch (col?.type) {
    case "number":  return "number";
    case "logical": return "checkbox";
    case "date":    return col.cells.some((c) => typeof c === "number" && !Number.isInteger(c)) ? "datetime" : "date";
    default:        return "text";
  }
}

function nowSerial(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569;
}

export class WriteObsidianNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "The Document to write as a note. Only Run writes; the node loads disarmed.",
    path: "The note to write: a vault-relative path, or a bare name without .md. A leading folder overrides the subfolder.",
    rows: "Rows to write as properties: a path column names each note, a note-body column writes its body, every other column its frontmatter. Only Run writes.",
    plan: "One row per note and property: the current value, the value to write, and what Run would do. Empty for a Note.",
  };
  label: string;
  subfolder: string;
  mode: ObsidianWriteMode;
  stamp: boolean;
  target: WriteObsidianTarget;
  addMissing = true;
  writeBase = false;
  stringLiterals: Record<string, string> = { path: "", keys: "" };
  enabled = false;
  cachedDoc: DocumentValue | SolError | null = null;
  private resolvedPath = "";
  cachedCube: CubeValue | SolError | null = null;
  cachedPlan: FrameValue | SolError | null = null;
  private planRows: PlanRow[] = [];
  private _mdbaseCache = new Map<string, MdbaseCollection | null>();
  status: ObsidianWriteStatus = "idle";
  statusMessage = "";
  lastWritten = "";
  width = 262; height = 280;

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

  resolveMode(): "note" | "properties" {
    if (this.target === "note") return "note";
    if (this.target === "properties") return "properties";
    return isCubeValue(this.cachedCube) && !isDocumentValue(this.cachedDoc) ? "properties" : "note";
  }

  data(inputs: { in?: (DocumentValue | SolError)[]; path?: (string | null)[]; rows?: (CubeValue | SolError | null)[] }): { plan: FrameValue | SolError | null } {
    this.cachedDoc = inputs.in?.[0] ?? null;
    this.resolvedPath = (readInput(inputs.path, this.stringLiterals?.path ?? "") ?? "").trim();
    const raw = inputs.rows?.[0] ?? null;
    if (raw !== this.cachedCube) { // re-plan only on a new cube, because Preview mutates planRows
      this.cachedCube = raw;
      if (isSolError(raw)) { this.cachedPlan = raw; this.planRows = []; }
      else if (!isCubeValue(raw)) { this.cachedPlan = null; this.planRows = []; }
      else { this.planRows = planPropertyWrites(raw, this.stringLiterals.keys ?? "", noteNamesOf(raw)); this.cachedPlan = propertyPlanFrame(this.planRows); }
    }
    return { plan: this.cachedPlan };
  }

  renderedTarget(): { name: string; subfolder: string } {
    const parts = this.resolvedPath.split("/").filter(Boolean);
    const name = (parts.pop() ?? "").replace(/\.md$/i, "").trim();
    const subfolder = [this.subfolder.trim().replace(/^\/+|\/+$/g, ""), ...parts].filter(Boolean).join("/");
    return { name, subfolder };
  }

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

  async run(): Promise<void> {
    if (this.status === "writing" || this.status === "previewing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled. Arm it first."; return; }
    const vault = getVaultRoot().trim();
    if (isDemoVaultPath(vault)) { this.status = "error"; this.statusMessage = "The demo vault is read-only"; return; }
    if (!hasFs()) { this.status = "error"; this.statusMessage = "Writing needs the desktop app"; return; }
    if (!vault) { this.status = "error"; this.statusMessage = "Set the vault folder in Settings"; return; }
    if (this.resolveMode() === "properties") { await this.runProperties(vault); return; }
    await this.runNote(vault);
  }

  async preview(): Promise<void> {
    if (this.status === "writing" || this.status === "previewing") return;
    const vault = getVaultRoot().trim();
    if (!hasFs() && !isDemoVaultPath(vault)) { this.status = "error"; this.statusMessage = "Preview needs the desktop app"; return; }
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
      if (res.pages === 0) { this.statusMessage = "The merge has no rows, so no note was written"; return; }
      this.lastWritten = res.file;
      const count = doc.total && doc.total > res.pages ? `${res.pages} of ${doc.total}` : `${res.pages}`;
      const what = res.pages > 1 ? `${count} notes${subfolder ? ` in ${subfolder}` : ""}` : res.file;
      this.statusMessage = res.assets > 0 ? `Wrote ${what} + ${res.assets} asset${res.assets === 1 ? "" : "s"}` : `Wrote ${what}`;
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
          if (r.key === "tags") { r.value = frontmatterTags(text, r.value); r.after = displayValue(r.value); }
          const { action, before } = resolveKey(text, r.key, r.value);
          r.before = before;
          r.action = action === "add" && !this.addMissing ? "unchanged" : action;
          r.reason = undefined;
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
          const value = r.key === "tags" ? frontmatterTags(text, r.value) : r.value;
          const { action } = resolveKey(text, r.key, value);
          if (action === "add" && !this.addMissing) continue;
          if (action === "unchanged") continue;
          if (sch) {
            if (sch.required.includes(r.key) && value === null) continue;
            const c = sch.constraints[r.key];
            if (c && validateAgainst(value, c)) continue;
          }
          patch[r.key] = value;
          touched++;
          const typeName = action === "add" && cube ? obsidianTypeName(cube, r.key) : null;
          if (typeName) newTypes.set(r.key, typeName);
        }
        for (const stampKey of ["dateModified", "updated"]) {
          const cur = resolveKey(text, stampKey, "");
          if (cur.action !== "add") patch[stampKey] = formatDateSerial(nowSerial(), /^\d{4}-\d{2}-\d{2}$/.test(cur.before) ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
        }
        if (touched === 0) continue;
        let out = Object.keys(patch).length ? patchFrontmatter(text, patch).text : text;
        if (newBody !== null) out = setBody(out, newBody);
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
      const file = await joinPath(vault, ".obsidian", "types.json");
      let text: string | null = null;
      try { text = await readVaultFile(vault, ".obsidian/types.json"); } catch { if (await pathExists(file)) return; }
      // A file that is there but unreadable as JSON is left alone, never replaced by the few keys added here.
      const parsed = (text === null ? {} : JSON.parse(text)) as { types?: Record<string, string> };
      const types: Record<string, string> = { ...(parsed.types ?? {}) };
      let added = false;
      for (const [k, t] of newTypes) if (!(k in types)) { types[k] = t; added = true; }
      if (!added) return;
      await writeTextFilePath(file, JSON.stringify({ ...parsed, types }, null, 2) + "\n");
    } catch { /* registration is a convenience, never a write failure */ }
  }
}

const IMPORT_RESERVED: ReadonlySet<string> = new Set(["document", "path"]);

export class ImportObsidianNode extends NoteNode {
  static socketDocs: Record<string, string> = {
    document: "The note's full text, frontmatter included.",
    path: "The note's vault-relative path. An incoming path loads that note instead of the picked one.",
  };
  fileName: string;
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
    this.addInput("path", strIn("Path"));
    this.addOutput("path", strOut("Path"));
  }

  protected reservedOutputs(): ReadonlySet<string> { return IMPORT_RESERVED; }

  async loadColumnPicks(vault: string): Promise<void> {
    const { readVaultFile } = await import("../fileBridge");
    const { parsePluginColumnTypes, PLUGIN_DATA_PATH } = await import("../pluginColumnTypes");
    try { this.columnPicks = parsePluginColumnTypes(await readVaultFile(vault, PLUGIN_DATA_PATH)); }
    catch { this.columnPicks = {}; }
  }

  private _wiredPath = "";
  private _seenGen = `${connectionStore.gen()}:${connectionStore.token(this.id)}`;

  data(inputs?: { path?: (string | null)[] }): ReturnType<NoteNode["data"]> {
    const wired = (readInput(inputs?.path, "") ?? "").trim();
    const readable = hasFs() || isDemoVaultPath(getVaultRoot());
    // A refresh (all connections, or this card's own timer) re-reads the note here, so a card that is not mounted refreshes too.
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
    const gen = `${connectionStore.gen()}:${connectionStore.token(this.id)}`;
    const refresh = gen !== this._seenGen;
    this._seenGen = gen;
    // Dedupe on the raw wired value, not fileName (which gains `.md`), or a stable input reloads forever.
    if (!wired) {
      this._wiredPath = "";
      if (refresh && readable && this.fileName) void trackInflight(this.reloadFile());
    } else if ((wired !== this._wiredPath || refresh) && readable) {
      this._wiredPath = wired;
      void trackInflight(this.loadFromWire(wired, refresh));
    }
    const base = super.data();
    return base instanceof Promise
      ? base.then((r) => ({ ...r, path: this.fileName }))
      : { ...base, path: this.fileName };
  }

  /** A note renamed or deleted since keeps what was loaded. */
  async reloadFile(): Promise<void> {
    try {
      const vault = getVaultRoot().trim();
      const { readVaultFile } = await import("../fileBridge");
      await this.applyFile(vault, this.fileName, await readVaultFile(vault, this.fileName));
    } catch { /* gone: keep the current body */ }
  }

  private async loadFromWire(path: string, force = false): Promise<void> {
    try {
      const vault = getVaultRoot().trim();
      const { readVaultFile, listVaultMarkdownFiles } = await import("../fileBridge");
      const withMd = /\.md$/i.test(path) ? path : `${path}.md`;
      const files = await listVaultMarkdownFiles(vault);
      const base = (path.split("/").pop() ?? path).replace(/\.md$/i, "").toLowerCase();
      const rel = files.includes(withMd) ? withMd
        : files.find((f) => (f.split("/").pop() ?? f).replace(/\.md$/i, "").toLowerCase() === base) ?? null;
      if (!rel || (rel === this.fileName && !force)) return;
      await this.applyFile(vault, rel, await readVaultFile(vault, rel));
    } catch { /* unreadable (moved / renamed / off-desktop) — keep the current body */ }
  }

  private async applyFile(vault: string, rel: string, content: string): Promise<void> {
    if (content === this.body && rel === this.fileName) return;
    this.body = content;
    this.fileName = rel;
    if (this.label === "Import Obsidian Note" || this.label.trim() === "") {
      this.label = (rel.split("/").pop() ?? rel).replace(/\.md$/i, "");
    }
    await this.loadColumnPicks(vault);
    const { removed, retyped } = this.syncFields();
    const { dropStrandedFrontmatterCables } = await import("../noteFrontmatterSync");
    await dropStrandedFrontmatterCables(this.id, removed, retyped);
    const view = getOwningView(this.id);
    await view?.rerenderNode(this.id);
    const editor = getOwningEditor(this.id);
    if (editor && view && retyped.length) (await import("../fcReconcile")).reconcileFcTypes(editor, view);
    scheduleConnectionRecalc(this.id);
  }
}
