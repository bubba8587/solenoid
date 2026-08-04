import { ClassicPreset } from "rete";
import { trueAnyIn, documentOut } from "./shared";
import { extractInlineRefs } from "../noteInlineRefs";
import { makeDocument, type DocumentValue } from "../documentValue";

// A markdown DOCUMENT node edited in ReportOverlay; the canvas card is only an
// anchor. Unlike Note it is a pure SINK — no frontmatter output half.

export class ReportNode extends ClassicPreset.Node {
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
    // The whole content as a DocumentValue, for a sink like Write-to-Obsidian.
    this.addOutput("document", documentOut("Document"));
    this.syncRefs();
  }

  /** Inline-ref INPUT keys (source order) — one per distinct `` `=name` `` span. */
  refKeys(): string[] { return this._refKeys; }
  /** The last value resolved for a ref input (undefined until the first compute). */
  refValue(key: string): unknown { return this._refValues.get(key); }

  /** Reconcile INPUT sockets from the body's `` `=name` `` spans; the caller drops
   *  the cables of `removedInputs`, as with NoteNode's syncFields. */
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

  // `inputs` is optional so a bare `new ReportNode().data()` can't throw with no
  // engine; serialization is the sink's job at write time.
  data(inputs?: Record<string, unknown[]>): { document: DocumentValue } {
    this._refValues = new Map(this._refKeys.map((k) => [k, inputs?.[k]?.[0] ?? null]));
    return { document: makeDocument(this.body, Object.fromEntries(this._refValues), undefined, this.id) };
  }
}
