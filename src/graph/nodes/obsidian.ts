import { ClassicPreset } from "rete";
import { documentIn } from "./shared";
import { NoteNode } from "./annotation";
import { type FrontmatterFieldType } from "../noteFrontmatter";
import { isDocumentValue, type DocumentValue } from "../documentValue";
import { isSolError, type SolError } from "../errorValue";
import { isDesktop } from "../fileBridge";
import { settingsStore } from "../settingsStore";

import { getOwningEditor } from "../activeGraph";
// obsidianWrite is imported lazily INSIDE run(): pulling its subtree eagerly through
// the rete-nodes barrel creates an init cycle (…→ documentStore → persistence →
// nodeCatalog → rete-nodes) that leaves catalog metadata undefined at eval time.

// The `.md` write fires ONLY from the Run button, and `enabled` is kept OUT of
// copyPaste's persistence whitelist so every load/paste/restore starts disarmed.

export type ObsidianWriteStatus = "idle" | "writing" | "ok" | "error";

export class WriteObsidianNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "Wiring a document never writes the note. The write runs only from the Run button, and the node loads disarmed.",
  };
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
    if (!isDesktop()) { this.status = "error"; this.statusMessage = "Desktop app only"; return; }
    const vault = settingsStore.get("obsidianVault").trim();
    if (!vault) { this.status = "error"; this.statusMessage = "Set the vault folder in Settings"; return; }
    const name = (this.fileName || this.label || "note").replace(/\.md$/i, "").trim();
    if (!name) { this.status = "error"; this.statusMessage = "Name the note"; return; }
    const doc = this.cachedDoc;
    if (isSolError(doc)) { this.status = "error"; this.statusMessage = doc.code; return; }
    if (!isDocumentValue(doc)) { this.status = "error"; this.statusMessage = "Nothing to write. Connect a Note or Report."; return; }
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

// It IS a Note (extends NoteNode), reusing the frontmatter-socket machinery and
// adding only a source path + read-only body, which persists so a loaded doc shows
// the imported content on web too.

export class ImportObsidianNode extends NoteNode {
  /** Vault-relative path of the source `.md` file ("" until one is picked). */
  fileName: string;

  constructor(init?: {
    label?: string; body?: string; color?: string; width?: number; height?: number;
    collapsed?: boolean; fieldTypes?: Record<string, FrontmatterFieldType>; fileName?: string;
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
  }
}
