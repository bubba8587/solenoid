import { ClassicPreset } from "rete";
import { documentIn } from "./shared";
import { NoteNode } from "./annotation";
import { type FrontmatterFieldType } from "../noteFrontmatter";
import { isDocumentValue, type DocumentValue } from "../documentValue";
import { isSolError, type SolError } from "../errorValue";
import { isDesktop } from "../fileBridge";
import { settingsStore } from "../settingsStore";
import { getEditor } from "../process";
// NOTE: obsidianWrite (and its DOM/filesystem deps — imageAssets, canvasCapture,
// documentStore) is dynamically imported inside run(), NOT at module top. Pulling
// that subtree eagerly through the rete-nodes barrel creates an init cycle
// (…→ documentStore → persistence → nodeCatalog → rete-nodes) that leaves
// catalog metadata undefined at eval time. run() only fires on a desktop click, so
// the lazy import costs nothing and keeps this node module light.

// A document sink with the same arm/disarm safety shape as the CSV/JSON sinks:
// data() only CACHES the DocumentValue for the card preview; the `.md` write
// fires ONLY from the Run button, and `enabled` is deliberately kept OUT of
// copyPaste's persistence whitelist so every load/paste/restore starts
// disarmed. Desktop only.

export type ObsidianWriteStatus = "idle" | "writing" | "ok" | "error";

export class WriteObsidianNode extends ClassicPreset.Node {
  label: string;
  /** The note file name (no extension — ".md" is appended at write). */
  fileName: string;
  /** Vault-relative destination subfolder ("" = the vault root). */
  subfolder: string;
  /** Never persisted (see sink.ts) — always false on a fresh construction. */
  enabled = false;
  cachedDoc: DocumentValue | SolError | null = null;
  status: ObsidianWriteStatus = "idle";
  statusMessage = "";
  width = 262; height = 250;

  constructor(init?: { label?: string; fileName?: string; subfolder?: string }) {
    super("WriteObsidian");
    this.label = init?.label ?? "Write to Obsidian";
    this.fileName = init?.fileName ?? "";
    this.subfolder = init?.subfolder ?? "";
    this.addInput("in", documentIn("Document"));
  }

  // Caches only — never touches disk.
  data(inputs: { in?: (DocumentValue | SolError)[] }): Record<string, never> {
    this.cachedDoc = inputs.in?.[0] ?? null;
    return {};
  }

  /** ref name → source node id, for the document-producing node wired to this
   *  sink. Walks the editor: this node's `in` → the producer (Report/Note), then
   *  the producer's ref inputs → their sources. Used only to rasterize a chart ref
   *  (it needs the source node's live SVG). Empty with no editor (tests) or nothing
   *  wired. */
  private refSources(): Map<string, string> {
    const out = new Map<string, string>();
    const ed = getEditor();
    if (!ed) return out;
    const conns = ed.getConnections();
    const toMe = conns.find((c) => c.target === this.id && c.targetInput === "in");
    if (!toMe) return out;
    for (const c of conns) {
      if (c.target === toMe.source) out.set(c.targetInput, c.source);
    }
    return out;
  }

  /** Explicit write — call ONLY from the node's Run button. Re-entrancy-guarded
   *  (a second Run mid-write is a no-op). Desktop only. */
  async run(): Promise<void> {
    if (this.status === "writing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled; arm it first"; return; }
    if (!isDesktop()) { this.status = "error"; this.statusMessage = "Desktop app only"; return; }
    const vault = settingsStore.get("obsidianVault").trim();
    if (!vault) { this.status = "error"; this.statusMessage = "Set the vault folder in Settings"; return; }
    const name = (this.fileName || this.label || "note").replace(/\.md$/i, "").trim();
    if (!name) { this.status = "error"; this.statusMessage = "Name the note"; return; }
    const doc = this.cachedDoc;
    if (isSolError(doc)) { this.status = "error"; this.statusMessage = doc.code; return; }
    if (!isDocumentValue(doc)) { this.status = "error"; this.statusMessage = "Nothing to write; connect a Note or Report"; return; }
    this.status = "writing";
    try {
      const { writeDocumentToVault } = await import("../obsidianWrite");
      const res = await writeDocumentToVault(doc, {
        vault,
        subfolder: this.subfolder,
        assetSubfolder: settingsStore.get("obsidianAssetSubfolder"),
        name,
        refSources: this.refSources(),
      });
      this.status = "ok";
      this.statusMessage = res.assets > 0
        ? `Wrote ${res.file} + ${res.assets} asset${res.assets === 1 ? "" : "s"}`
        : `Wrote ${res.file}`;
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }
}

// The read side: a `.md` picked from the vault becomes a Note. It IS a Note
// (extends NoteNode), so it reuses the frontmatter-socket + document machinery
// and reads as a note everywhere; it only adds the source file path and a
// read-only, file-sourced body. The body persists in the save, so a loaded doc
// shows the imported content on web too.

export class ImportObsidianNode extends NoteNode {
  /** Vault-relative path of the source `.md` file ("" until one is picked). */
  fileName: string;

  constructor(init?: {
    label?: string; body?: string; color?: string; width?: number; height?: number;
    collapsed?: boolean; fieldTypes?: Record<string, FrontmatterFieldType>; fileName?: string;
  }) {
    super({
      label: init?.label ?? "Imported Note",
      body: init?.body ?? "",
      color: init?.color ?? "violet",
      width: init?.width ?? 345,
      height: init?.height ?? 150,
      collapsed: init?.collapsed,
      fieldTypes: init?.fieldTypes,
    });
    this.fileName = init?.fileName ?? "";
  }
}
