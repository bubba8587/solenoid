import { ClassicPreset } from "rete";
import { trueAnyIn, documentOut, documentIn, cubeIn } from "./shared";
import { NoteNode } from "./annotation";
import { isDocumentValue, makeDocument, PAGE_SEPARATOR, type DocumentValue, type DocumentPage } from "../documentValue";
import {
  embedBareVariables, extractKnapVariables, hasKnapSyntax, knapErrorText, renderKnap, renderKnapPages, toTemplateValue,
} from "../knapTemplate";
import { isFrameRef, readFrame } from "../frameBackend";
import { solError, type SolError } from "../errorValue";
import { getActiveView, getOwningEditor } from "../activeGraph";
import { dropInputCables } from "../components/cablePrune";
import { SolenoidSocket, type SocketDataType } from "../sockets";

// A markdown DOCUMENT node edited in ReportOverlay; the canvas card is only an
// anchor. Unlike Note it is a pure SINK — no frontmatter output half. The body is a
// Knap template (knapTemplate.ts): every root `{{ name }}` mints an input, a bare
// one embeds the wired value by kind, and the document carries the RENDERED body.
//
// Two FIXED inputs widen it: `template` takes a wired Note (a vault template,
// imported) as the body instead — its variables mint the sockets, its own
// frontmatter fills any left unwired; `records` takes a frame or cube, the MAIL MERGE
// list, and renders one PAGE per row (`record`, `index`), which Write to Obsidian
// writes as one note each.

const FIXED = new Set(["template", "records"]);
/** The merge's own names once `records` is wired: bound per page, never a socket. */
const BATCH_LOCALS = new Set(["record", "index"]);

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export class ReportNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    document: "Carries the report's markdown, the template rendered, with every embedded value resolved to its wired value. One page per record when Records is wired.",
    template: "A wired Note becomes the report's template: its tags mint the inputs here, and its own frontmatter fills any input left unwired. The report's own text is set aside while it is wired.",
    records: "The mail-merge list, a frame or cube: the template renders once per row, with `record` and `index` beside the other inputs, and the page name names each note.",
  };
  /** Frames arrive AS frames (typed date columns) rather than type-stripped cubes. */
  rawInputs: ReadonlySet<string> = new Set(["records"]);

  body: string;         // markdown — blank by default
  color: string;        // palette SLOT id — tints the anchor card, like Note
  width: number;
  height: number;
  collapsed: boolean;
  /** The input keys minted from a WIRED template — persisted so a saved cable finds
   *  its socket at load, before the first compute knows the template. */
  sideVars: string[];
  /** Knap for each page's note name when `records` is wired (`{{ record.Name }}`); blank
   *  names pages by index. */
  pageName: string;

  private _refKeys: string[] = [];
  private _refValues = new Map<string, unknown>();
  private _computed = false;
  private _templateDoc: DocumentValue | null = null;
  private _recordsValue: unknown = null;
  private _records: Record<string, unknown>[] | null = null;
  private _pages: DocumentPage[] | null = null;
  /** The data form of every input as of the last compute (runtime only) — the
   *  overlay's live preview and the webpage export render with it. */
  templateVars: Record<string, unknown> = {};

  constructor(init?: {
    label?: string; body?: string; color?: string;
    width?: number; height?: number; collapsed?: boolean; sideVars?: string[]; pageName?: string;
  }) {
    super(init?.label ?? "Report");
    this.body = init?.body ?? "";
    this.color = init?.color ?? "sky";
    this.width = init?.width ?? 200;
    this.height = init?.height ?? 96;
    this.collapsed = init?.collapsed ?? false;
    this.sideVars = Array.isArray(init?.sideVars) ? init.sideVars.filter((v) => typeof v === "string") : [];
    this.pageName = init?.pageName ?? "";
    this.addInput("template", documentIn("Template"));
    this.addInput("records", cubeIn("Records"));
    // The whole content as a DocumentValue, for a sink like Write-to-Obsidian.
    this.addOutput("document", documentOut("Document"));
    this.syncRefs();
  }

  /** Variable INPUT keys (first-use order) — one per root template variable. */
  refKeys(): string[] { return this._refKeys; }
  /** The last value resolved for a variable input (undefined until the first compute). */
  refValue(key: string): unknown { return this._refValues.get(key); }
  /** The wired template document, when one is (null otherwise). */
  get templateDoc(): DocumentValue | null { return this._templateDoc; }
  /** The wired records value as it arrived (a frame/cube), for the card's row. */
  get recordsValue(): unknown { return this._recordsValue; }
  /** The records as template data, when wired (the overlay previews pages with them). */
  get records(): Record<string, unknown>[] | null { return this._records; }
  /** The pages of the last compute, when `records` was wired. */
  get pages(): DocumentPage[] | null { return this._pages; }

  /** The template text in force: the wired Note's raw source, else the body. */
  activeSource(): string {
    return this._templateDoc ? (this._templateDoc.source ?? this._templateDoc.body) : this.body;
  }

  /** Reconcile the variable INPUT sockets to the body (the overlay calls this on a
   *  body commit); the caller drops the cables of `removedInputs`, as with
   *  NoteNode's syncFields. With a template wired the sockets follow the template
   *  instead (data() reconciles them); before the first compute, the persisted
   *  `sideVars` are kept too so restored cables find their sockets. */
  syncRefs(): { removedInputs: string[] } {
    const wanted = this._templateDoc ? [...this.sideVars] : this.hostVariables(this.body);
    if (!this._computed) for (const v of this.sideVars) if (!wanted.includes(v)) wanted.push(v);
    const removedInputs: string[] = [];
    for (const key of Object.keys(this.inputs)) {
      if (FIXED.has(key)) continue;
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

  /** The root names a source reads from the HOST: the fixed inputs are their own
   *  sockets, and with records wired `record`/`index` are the page's. */
  private hostVariables(source: string): string[] {
    return extractKnapVariables(source).filter((k) => !FIXED.has(k) && !(this._recordsValue != null && BATCH_LOCALS.has(k)));
  }

  /** data()-driven reconcile (a wired template's variables changed): the sockets
   *  follow via a microtask, departing cables pruned first (rules onePrunePath). */
  private reconcileInputs(desired: string[]): void {
    const added = desired.filter((k) => !this.inputs[k]);
    const removed = Object.keys(this.inputs).filter((k) => !FIXED.has(k) && !desired.includes(k));
    this._refKeys = desired;
    if (added.length === 0 && removed.length === 0) return;
    queueMicrotask(() => {
      void (async () => {
        for (const k of added) if (!this.inputs[k]) this.addInput(k, trueAnyIn(k));
        await dropInputCables(this.id, removed);
        for (const k of removed) if (this.inputs[k]) this.removeInput(k);
        await getActiveView()?.rerenderNode(this.id);
      })();
    });
  }

  /** The body the engine renders: bare `{{ input }}` tags become ref spans; the
   *  rest is Knap. The overlay previews a DRAFT body through the same rewrite. */
  templateSource(body: string = this.activeSource()): string {
    const wired = [...this._refKeys];
    if (this._templateDoc) wired.push("template");
    if (this._recordsValue != null) wired.push("records");
    return embedBareVariables(body, wired);
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

  /** The wired values as template data; a lazy frame reads in full first. An input
   *  that is neither wired nor defaulted is ABSENT, not null: Knap reads a bare filter
   *  argument (`list:numbered`) as a variable and falls back to the word only when the
   *  name is undefined, and `{{ x ?? "none" }}` needs the same. */
  private async templateVariables(refs: Record<string, unknown>, present: ReadonlySet<string>, fallbackTypes: Map<string, SocketDataType | undefined>): Promise<Record<string, unknown>> {
    const types = this.sourceTypes();
    const vars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(refs)) {
      if (!present.has(k)) continue;
      vars[k] = toTemplateValue(isFrameRef(v) ? await readFrame(v) : v, types.get(k) ?? fallbackTypes.get(k));
    }
    return vars;
  }

  /** The rendered body against the LAST compute's variables — for a consumer that
   *  needs the text outside the engine (the webpage export). Errors render as "". */
  async renderedBody(): Promise<string> {
    const src = this.templateSource();
    if (this._records) {
      const r = await renderKnapPages(src, this.templateVars, this._records, this.pageName);
      return r.pages.map((p) => p.body).join(PAGE_SEPARATOR);
    }
    return (await renderKnap(src, this.templateVars)).output;
  }

  // `inputs` is optional so a bare `new ReportNode().data()` can't throw with no
  // engine; serialization is the sink's job at write time. Async ONLY when the
  // source still carries a tag after the bare-variable rewrite, or records are wired —
  // a report of prose and embeds stays off the engine's async path.
  data(inputs?: Record<string, unknown[]>): { document: DocumentValue | SolError } | Promise<{ document: DocumentValue | SolError }> {
    this._computed = true;
    const tpl = inputs?.template?.[0];
    this._templateDoc = isDocumentValue(tpl) ? tpl : null;
    this._recordsValue = inputs?.records?.[0] ?? null;
    const source = this.activeSource();

    // The sockets follow the active source; a wired template's keys persist. The
    // names `template` and `records` ARE the fixed inputs (a bare `{{ records }}` embeds
    // the wired frame; a loop over `records` reads it), so they never mint a socket.
    const desired = this.hostVariables(source);
    if (!sameList(desired, this._refKeys)) this.reconcileInputs(desired);
    this.sideVars = this._templateDoc ? [...desired] : [];

    // An unwired input falls back to the template note's own field of that name.
    const tplNote = this._templateDoc ? new NoteNode({ body: source }) : null;
    const defaults = tplNote?.fieldValues() ?? {};
    const fallbackTypes = new Map<string, SocketDataType | undefined>(Object.keys(defaults).map((k) => [k, tplNote!.fieldType(k)]));
    this._refValues = new Map(desired.map((k) => [k, inputs?.[k] !== undefined ? (inputs[k][0] ?? null) : (defaults[k] ?? null)]));
    const refs: Record<string, unknown> = Object.fromEntries(this._refValues);
    const present = new Set(desired.filter((k) => inputs?.[k] !== undefined || k in defaults));
    if (this._templateDoc) { refs.template = this._templateDoc; present.add("template"); }
    if (this._recordsValue != null) { refs.records = this._recordsValue; present.add("records"); }

    const src = this.templateSource(source);
    const recordsIn = this._recordsValue;
    if (recordsIn == null && !hasKnapSyntax(src)) {
      this._records = null; this._pages = null;
      return { document: makeDocument(src, refs, undefined, this.id) };
    }
    return (async () => {
      this.templateVars = await this.templateVariables(refs, present, fallbackTypes);
      if (this._templateDoc) this.templateVars.template = source;
      if (recordsIn != null) {
        const raw = isFrameRef(recordsIn) ? await readFrame(recordsIn) : recordsIn;
        const rows = toTemplateValue(raw);
        this._records = Array.isArray(rows) ? rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r)) : [];
        this.templateVars.records = this._records;
        const r = await renderKnapPages(src, this.templateVars, this._records, this.pageName);
        if (r.errors.length) { this._pages = null; return { document: solError("#SYNTAX!", knapErrorText(r.errors)) }; }
        this._pages = r.pages;
        return { document: makeDocument(r.pages.map((p) => p.body).join(PAGE_SEPARATOR), refs, undefined, this.id, { pages: r.pages }) };
      }
      this._records = null; this._pages = null;
      const r = await renderKnap(src, this.templateVars);
      if (r.errors.length) return { document: solError("#SYNTAX!", knapErrorText(r.errors)) };
      return { document: makeDocument(r.output, refs, undefined, this.id) };
    })();
  }
}
