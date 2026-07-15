import { ClassicPreset } from "rete";
import { trueAnyIn, documentOut } from "./shared";
import { extractInlineRefs } from "../noteInlineRefs";
import { makeDocument, type DocumentValue } from "../documentValue";

// ─── Report ─────────────────────────────────────────────────────────────────
// The report projection (bundle 13, #13): a standalone, blank-by-default markdown
// DOCUMENT, separate from the graph's ordinary node cards — its canvas presence is
// a minimal anchor card (ReportComponent) with an "Open Report" button; the real
// editing surface is the full-screen ReportOverlay (reportStore.ts). It's a real
// Rete node anyway (like Note/Group) so it gets persistence, undo, and — the
// point — REAL wireable input sockets for its `` `=name` `` refs, for free.
//
// Reuses noteInlineRefs.ts's parser (the exact mechanism NoteNode uses for its
// inline-ref inputs) and inlineRefDisplay.tsx's renderer (the exact component
// NoteNode uses to swap a span for its live value) — a Report ref behaves
// identically to a Note ref, just hosted on a document instead of a sticky card.
// Unlike Note, a Report has NO output-socket half (no frontmatter) — it's a
// terminal consumer, a sink, not a constants source.
//
// `embeds`: ids of existing Note nodes placed as objects in the report (rendered
// as read-only mini previews in the overlay — see ReportOverlay.tsx). Explicit
// list rather than an inline placement token, so embedding doesn't require new
// markdown syntax on top of the inline-ref one.

export class ReportNode extends ClassicPreset.Node {
  // `label` (from ClassicPreset.Node) is the editable header name, mirroring how
  // every other node titles its header — not redeclared here (see NoteNode).
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
    // ref values), for a document sink like Write-to-Obsidian. This is NOT the
    // frontmatter-property output the "Report is a pure sink" rule forbade — it's the
    // rendered document as a single value (author OK'd 2026-07-15).
    this.addOutput("document", documentOut("Document"));
    this.syncRefs();
  }

  /** Inline-ref INPUT keys (source order) — one per distinct `` `=name` `` span. */
  refKeys(): string[] { return this._refKeys; }
  /** The last value resolved for a ref input (undefined until the first compute). */
  refValue(key: string): unknown { return this._refValues.get(key); }

  /**
   * Reconcile `any`-typed INPUT sockets from the body's `` `=name` `` spans — the
   * same mechanism as NoteNode.syncFields' ref half (see nodes/annotation.ts),
   * minus the frontmatter/output half a Report doesn't have. `removedInputs` is
   * for the caller (ReportOverlay's commit) to drop dangling cables, same contract
   * as NoteNode's syncFields.
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

  // `inputs` carries the resolved ref values, cached for the overlay to render
  // inline (mirrors DisplayNode's `cachedValue`) AND assembled into the `document`
  // output — the report's raw body + those resolved refs (no frontmatter; a Report
  // has none). Serialization (refs → markdown, `![[Note]]` → note bodies, charts →
  // images) is the sink's job at write time. Optional `inputs` for the same reason
  // as NoteNode: a bare `new ReportNode().data()` must not throw with no engine.
  data(inputs?: Record<string, unknown[]>): { document: DocumentValue } {
    this._refValues = new Map(this._refKeys.map((k) => [k, inputs?.[k]?.[0] ?? null]));
    return { document: makeDocument(this.body, Object.fromEntries(this._refValues)) };
  }
}
