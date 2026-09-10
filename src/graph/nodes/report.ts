import { ClassicPreset } from "rete";
import { trueAnyIn, documentOut } from "./shared";
import { makeDocument, type DocumentValue } from "../documentValue";
import { embedBareVariables, extractKnapVariables, hasKnapSyntax, knapErrorText, renderKnap, toTemplateValue } from "../knapTemplate";
import { isFrameRef, readFrame } from "../frameBackend";
import { solError, type SolError } from "../errorValue";
import { getOwningEditor } from "../activeGraph";
import { SolenoidSocket, type SocketDataType } from "../sockets";

// A markdown DOCUMENT node edited in ReportOverlay; the canvas card is only an
// anchor. Unlike Note it is a pure SINK — no frontmatter output half. The body is a
// Knap template (knapTemplate.ts): every root `{{ name }}` mints an input, a bare
// one embeds the wired value by kind, and the document carries the RENDERED body.

export class ReportNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    document: "Carries the report's markdown, the template rendered, with every embedded value resolved to its wired value.",
  };

  body: string;         // markdown — blank by default
  color: string;        // palette SLOT id — tints the anchor card, like Note
  width: number;
  height: number;
  collapsed: boolean;

  private _refKeys: string[] = [];
  private _refValues = new Map<string, unknown>();
  /** The data form of every input as of the last compute (runtime only) — the
   *  overlay's live preview and the webpage export render with it. */
  templateVars: Record<string, unknown> = {};

  constructor(init?: {
    label?: string; body?: string; color?: string;
    width?: number; height?: number; collapsed?: boolean;
  }) {
    super(init?.label ?? "Report");
    this.body = init?.body ?? "";
    this.color = init?.color ?? "sky";
    this.width = init?.width ?? 200;
    this.height = init?.height ?? 96;
    this.collapsed = init?.collapsed ?? false;
    // The whole content as a DocumentValue, for a sink like Write-to-Obsidian.
    this.addOutput("document", documentOut("Document"));
    this.syncRefs();
  }

  /** INPUT keys (first-use order) — one per root template variable. */
  refKeys(): string[] { return this._refKeys; }
  /** The last value resolved for an input (undefined until the first compute). */
  refValue(key: string): unknown { return this._refValues.get(key); }

  /** Reconcile INPUT sockets from the body's template variables; the caller drops
   *  the cables of `removedInputs`, as with NoteNode's syncFields. */
  syncRefs(): { removedInputs: string[] } {
    const wanted = extractKnapVariables(this.body);
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

  /** The body the engine renders: bare `{{ input }}` tags become ref spans; the
   *  rest is Knap. The overlay previews a DRAFT body through the same rewrite. */
  templateSource(body: string = this.body): string {
    return embedBareVariables(body, this._refKeys);
  }

  /** Each wired input's SOURCE socket type — the only way to read a date serial as
   *  a date (a `trueany` input carries no type of its own). Empty with no editor. */
  private sourceTypes(): Map<string, SocketDataType> {
    const out = new Map<string, SocketDataType>();
    const ed = getOwningEditor(this.id);
    if (!ed) return out;
    for (const c of ed.getConnections()) {
      if (c.target !== this.id) continue;
      const s = ed.getNode(c.source)?.outputs[c.sourceOutput]?.socket;
      if (s instanceof SolenoidSocket) out.set(c.targetInput, s.dataType);
    }
    return out;
  }

  /** The wired values as template data; a lazy frame reads in full first. */
  private async templateVariables(refs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const types = this.sourceTypes();
    const vars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(refs)) {
      vars[k] = toTemplateValue(isFrameRef(v) ? await readFrame(v) : v, types.get(k));
    }
    return vars;
  }

  /** The rendered body against the LAST compute's variables — for a consumer that
   *  needs the text outside the engine (the webpage export). Errors render as "". */
  async renderedBody(): Promise<string> {
    return (await renderKnap(this.templateSource(), this.templateVars)).output;
  }

  // `inputs` is optional so a bare `new ReportNode().data()` can't throw with no
  // engine; serialization is the sink's job at write time. Async ONLY when the
  // source still carries a tag after the bare-variable rewrite — a report of prose
  // and embeds stays off the engine's async path.
  data(inputs?: Record<string, unknown[]>): { document: DocumentValue | SolError } | Promise<{ document: DocumentValue | SolError }> {
    this._refValues = new Map(this._refKeys.map((k) => [k, inputs?.[k]?.[0] ?? null]));
    const refs = Object.fromEntries(this._refValues);
    const source = this.templateSource();
    if (!hasKnapSyntax(source)) return { document: makeDocument(source, refs, undefined, this.id) };
    return (async () => {
      this.templateVars = await this.templateVariables(refs);
      const r = await renderKnap(source, this.templateVars);
      if (r.errors.length) return { document: solError("#SYNTAX!", knapErrorText(r.errors)) };
      return { document: makeDocument(r.output, refs, undefined, this.id) };
    })();
  }
}
