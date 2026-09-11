import { ClassicPreset } from "rete";
import { documentIn, strIn, strOut, readInput } from "./shared";
import { formatDateSerial } from "./dateSerial";
import type { ObsidianWriteMode } from "../obsidianWrite";
import { NoteNode } from "./annotation";
import { type FrontmatterFieldType } from "../noteFrontmatter";
import { isDocumentValue, type DocumentValue } from "../documentValue";
import { isSolError, type SolError } from "../errorValue";
import { hasFs } from "../fileBridge";
import { settingsStore } from "../settingsStore";
import { trackInflight, scheduleConnectionRecalc } from "../connectionStore";

import { getOwningEditor, getOwningView } from "../activeGraph";
// obsidianWrite is imported lazily INSIDE run(): pulling its subtree eagerly through
// the rete-nodes barrel creates an init cycle (…→ documentStore → persistence →
// nodeCatalog → rete-nodes) that leaves catalog metadata undefined at eval time.

// The `.md` write fires ONLY from the Run button, and `enabled` is kept OUT of
// copyPaste's persistence whitelist so every load/paste/restore starts disarmed.

export type ObsidianWriteStatus = "idle" | "writing" | "ok" | "error";

export const OBSIDIAN_WRITE_MODE_OPTIONS: ReadonlyArray<{ value: ObsidianWriteMode; label: string; title: string }> = [
  { value: "overwrite", label: "Overwrite", title: "The note becomes the document" },
  { value: "append",    label: "Append",    title: "The document is added at the end of the note" },
  { value: "block",     label: "Block",     title: "The writer owns one hidden-marker block in the note; the rest of the note is yours" },
];

export class WriteObsidianNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "Wiring a document never writes the note. The write runs only from the Run button, and the node loads disarmed.",
    path: "The note to write: a vault-relative path or a bare name (no .md). Wire a path from a Vault Folder row, or pick one with Browse. A leading folder overrides the subfolder.",
  };
  label: string;
  /** Vault-relative destination subfolder ("" = the vault root). A leading folder on
   *  the `path` prepends to this. */
  subfolder: string;
  /** overwrite | append | block (a managed marker block the writer owns). */
  mode: ObsidianWriteMode;
  /** Link each written note back to a `Solenoid/<doc>` stub note (bundle D). Opt-in
   *  (author 2026-09-07): off unless the user turns it on. */
  stamp: boolean;
  /** Inline literal for the `path` input (InlineInputs): the note name or vault-relative
   *  path, no `.md`. A wired cable wins over it; Browse writes into it. */
  stringLiterals: Record<string, string> = {};
  /** Never persisted (see sink.ts) — always false on a fresh construction. */
  enabled = false;
  cachedDoc: DocumentValue | SolError | null = null;
  /** The path the last data() resolved (the wired `path`, else its literal). */
  private resolvedPath = "";
  status: ObsidianWriteStatus = "idle";
  statusMessage = "";
  /** The vault-relative path of the last note this card wrote (transient; Open in Obsidian). */
  lastWritten = "";
  width = 262; height = 250;

  constructor(init?: { label?: string; subfolder?: string; mode?: ObsidianWriteMode; stamp?: boolean }) {
    super("WriteObsidian");
    this.label = init?.label ?? "Write to Obsidian";
    this.subfolder = init?.subfolder ?? "";
    this.mode = init?.mode === "append" || init?.mode === "block" ? init.mode : "overwrite";
    this.stamp = init?.stamp === true;
    this.addInput("in", documentIn("Document"));
    this.addInput("path", strIn("Path"));
  }

  // Caches only — never touches disk.
  data(inputs: { in?: (DocumentValue | SolError)[]; path?: (string | null)[] }): Record<string, never> {
    this.cachedDoc = inputs.in?.[0] ?? null;
    this.resolvedPath = (readInput(inputs.path, this.stringLiterals?.path ?? "") ?? "").trim();
    return {};
  }

  /** The note name + subfolder the current `path` resolves to (the card's preview and
   *  what Run writes). A `folder/name` path splits: the last segment is the name, the
   *  rest prepends to the node's subfolder. */
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

  /** Call ONLY from the node's Run button; re-entrancy-guarded, desktop only. */
  async run(): Promise<void> {
    if (this.status === "writing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled. Arm it first."; return; }
    if (!hasFs()) { this.status = "error"; this.statusMessage = "Desktop app only"; return; }
    const vault = settingsStore.get("obsidianVault").trim();
    if (!vault) { this.status = "error"; this.statusMessage = "Set the vault folder in Settings"; return; }
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
        vault,
        subfolder,
        assetSubfolder: settingsStore.get("obsidianAssetSubfolder"),
        name,
        refSources: this.refSources(),
        mode: this.mode,
        blockName: this.label,
      });
      this.status = "ok";
      this.lastWritten = res.file;
      const what = res.pages > 1 ? `${res.pages} notes${subfolder ? ` in ${subfolder}` : ""}` : res.file;
      this.statusMessage = res.assets > 0
        ? `Wrote ${what} + ${res.assets} asset${res.assets === 1 ? "" : "s"}`
        : `Wrote ${what}`;
      // D: link the note back to a Solenoid/<doc> stub note (best effort — the write is
      // done). A batch stamps nothing: one stub line per page would flood the stub.
      if (this.stamp && res.pages === 1) {
        try {
          const { documentStore } = await import("../documentStore");
          const docName = documentStore.currentName();
          const d = new Date();
          const now = formatDateSerial(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569, "YYYY-MM-DDTHH:mm:ss");
          const { patchFrontmatter } = await import("../frontmatterPatch");
          const { readVaultFile, writeTextFilePath, joinPath, ensureDir } = await import("../fileBridge");
          const { stubLink, stubRelPath, mergeStub } = await import("../graphStub");
          // 1. the solenoid: backlink on the note itself.
          const noteText = await readVaultFile(vault, res.file);
          const patched = patchFrontmatter(noteText, { solenoid: stubLink(docName, this.label) });
          await writeTextFilePath(await joinPath(vault, ...res.file.split("/")), patched.text);
          // 2. create / refresh the stub note.
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
      const rel = /\.md$/i.test(path) ? path : `${path}.md`;
      const { readVaultFile } = await import("../fileBridge");
      const content = await readVaultFile(settingsStore.get("obsidianVault").trim(), rel);
      if (content === this.body && rel === this.fileName) return;
      this.body = content;
      this.fileName = rel;
      if (this.label === "Import Obsidian Note" || this.label.trim() === "") {
        this.label = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
      }
      const { removed, retyped } = this.syncFields();
      const { dropStrandedFrontmatterCables } = await import("../noteFrontmatterSync");
      await dropStrandedFrontmatterCables(this.id, removed, retyped);
      await getOwningView(this.id)?.rerenderNode(this.id);
      scheduleConnectionRecalc();
    } catch { /* unreadable (moved / renamed / off-desktop) — keep the current body */ }
  }
}
