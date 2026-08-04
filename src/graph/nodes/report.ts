import { ClassicPreset } from "rete";
import { trueAnyIn, documentOut } from "./shared";
import { extractInlineRefs } from "../noteInlineRefs";
import { makeDocument, type DocumentValue } from "../documentValue";

// A standalone markdown DOCUMENT node; the editing surface is the full-screen
// ReportOverlay (reportStore.ts), the canvas card is only an anchor. Unlike Note,
// a Report has NO frontmatter output half — it is a terminal consumer, a sink,
// not a constants source.
//
// `embeds`: ids of existing Note nodes placed as objects in the report. An explicit
// list rather than an inline placement token, so embedding doesn't require new
// markdown syntax on top of the inline-ref one.

export class ReportNode extends ClassicPreset.Node {
  // `label` (from ClassicPreset.Node) is the editable header name — not redeclared.
  body: string;         // markdown — blank by default
  embeds: string[];     // embedded Note node ids, placed-object style
  color: string;        // palette SLOT id — tints the anchor card, like Note
  width: number;
  height: number;
  collapsed: boolean;

  private _refKeys: string[] = [];
  private _refValues = new Map<string, unknown>();

  constructor(init?: {
    label?: string; body?: string; embeds?: string[]; color?: string;
    width?: number; height?: number; collapsed?: boolean;
  }) {
    super(init?.label ?? "Report");
    this.body = init?.body ?? "";
    this.embeds = init?.embeds ? [...init.embeds] : [];
    this.color = init?.color ?? "sky";
    this.width = init?.width ?? 200;
    this.height = init?.height ?? 96;
    this.collapsed = init?.collapsed ?? false;
    // The one OUTPUT: the report's whole content as a DocumentValue (body + resolved
    // ref values), for a document sink like Write-to-Obsidian.
    this.addOutput("document", documentOut("Document"));
    this.syncRefs();
  }

  /** Inline-ref INPUT keys (source order) — one per distinct `` `=name` `` span. */
  refKeys(): string[] { return this._refKeys; }
  /** The last value resolved for a ref input (undefined until the first compute). */
  refValue(key: string): unknown { return this._refValues.get(key); }

  /**
   * Reconcile `any`-typed INPUT sockets from the body's `` `=name` `` spans.
   * `removedInputs` is for the caller (ReportOverlay's commit) to drop dangling
   * cables — same contract as NoteNode's syncFields.
   */
  syncRefs(): { removedInputs: string[] } {
    const wanted = extractInlineRefs(this.body);
    const removedInputs: string[] = [];
    for (const key of Object.keys(this.inputs)) {
      if (!wanted.includes(key)) {
        this.removeInput(key);
        removedInputs.push(key);
      }
    }
    for (const key of wanted) {
      if (!this.inputs[key]) this.addInput(key, trueAnyIn(key));
    }
    this._refKeys = wanted;
    return { removedInputs };
  }

  /** Embed an existing Note as a placed object (no-op if already embedded). */
  addEmbed(noteId: string): void {
    if (!this.embeds.includes(noteId)) this.embeds.push(noteId);
  }
  removeEmbed(noteId: string): void {
    this.embeds = this.embeds.filter((id) => id !== noteId);
  }

  // Serialization (refs → markdown, `![[Note]]` → note bodies, charts → images) is
  // the sink's job at write time. `inputs` is optional for the same reason as
  // NoteNode: a bare `new ReportNode().data()` must not throw with no engine.
  data(inputs?: Record<string, unknown[]>): { document: DocumentValue } {
    this._refValues = new Map(this._refKeys.map((k) => [k, inputs?.[k]?.[0] ?? null]));
    return { document: makeDocument(this.body, Object.fromEntries(this._refValues), undefined, this.id) };
  }
}
