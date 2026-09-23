// [[C68]]
import { ClassicPreset } from "rete";
import { trueAnyIn, documentOut, documentIn, cubeIn } from "./shared";
import { NoteNode } from "./annotation";
import { isDocumentValue, makeDocument, PAGE_SEPARATOR, type DocumentValue, type DocumentPage } from "../documentValue";
import {
  embedBareVariables, extractKnapVariables, hasKnapSyntax, knapErrorText, renderKnap, renderKnapPages, toTemplateValue,
} from "../knapTemplate";
import { isFrameRef, readFrame } from "../frameBackend";
import { solError, type SolError } from "../errorValue";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { dropInputCables } from "../components/cablePrune";
import { SolenoidSocket, type SocketDataType } from "../sockets";

const FIXED = new Set(["template", "records"]);
const BATCH_LOCALS = new Set(["record", "index"]);

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export class ReportNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    document: "The rendered report as markdown, every embedded value resolved. In a mail merge, one page per record.",
    template: "A Note used as the template: its tags become the inputs and its frontmatter fills the ones left blank. The report's own text waits while it is in use.",
    records: "The mail-merge rows, a frame or cube: one page per row, with record and index in scope, named by the page name.",
  };
  rawInputs: ReadonlySet<string> = new Set(["records"]);

  body: string;        
  width: number;
  height: number;
  collapsed: boolean;
  /** Persisted, so a saved cable finds its socket before the first compute knows the template. */
  sideVars: string[];
  pageName: string;

  private _refKeys: string[] = [];
  private _refValues = new Map<string, unknown>();
  private _recordsFrame: unknown = undefined;
  private _computed = false;
  private _templateDoc: DocumentValue | null = null;
  private _recordsValue: unknown = null;
  private _recordsWired = false;
  private _records: Record<string, unknown>[] | null = null;
  private _pages: DocumentPage[] | null = null;
  templateVars: Record<string, unknown> = {};

  constructor(init?: {
    label?: string; body?: string;
    width?: number; height?: number; collapsed?: boolean; sideVars?: string[]; pageName?: string;
  }) {
    super(init?.label ?? "Report");
    this.body = init?.body ?? "";
    this.width = init?.width ?? 200;
    this.height = init?.height ?? 96;
    this.collapsed = init?.collapsed ?? false;
    this.sideVars = Array.isArray(init?.sideVars) ? init.sideVars.filter((v) => typeof v === "string") : [];
    this.pageName = init?.pageName ?? "";
    this.addInput("template", documentIn("Template"));
    this.addInput("records", cubeIn("Records"));
    this.addOutput("document", documentOut("Document"));
    this.syncRefs();
  }

  refKeys(): string[] { return this._refKeys; }
  refValue(key: string): unknown {
    if (key === "template") return this._templateDoc ?? undefined;
    if (key === "records") return this._recordsFrame ?? (isFrameRef(this._recordsValue) ? undefined : this._recordsValue ?? undefined);
    return this._refValues.get(key);
  }
  get templateDoc(): DocumentValue | null { return this._templateDoc; }
  get recordsValue(): unknown { return this._recordsValue; }
  get records(): Record<string, unknown>[] | null { return this._records; }
  get pages(): DocumentPage[] | null { return this._pages; }

  activeSource(): string {
    return this._templateDoc ? (this._templateDoc.source ?? this._templateDoc.body) : this.body;
  }

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

  private hostVariables(source: string): string[] {
    return extractKnapVariables(source).filter((k) => !FIXED.has(k) && !(this._recordsWired && BATCH_LOCALS.has(k)));
  }

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
        await getOwningView(this.id)?.rerenderNode(this.id);
      })();
    });
  }

  templateSource(body: string = this.activeSource()): string {
    const wired = [...this._refKeys];
    if (this._templateDoc) wired.push("template");
    if (this._recordsValue != null) wired.push("records");
    return embedBareVariables(body, wired);
  }

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

  private async templateVariables(refs: Record<string, unknown>, present: ReadonlySet<string>, fallbackTypes: Map<string, SocketDataType | undefined>): Promise<Record<string, unknown>> {
    const types = this.sourceTypes();
    const vars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(refs)) {
      if (!present.has(k)) continue;
      vars[k] = toTemplateValue(isFrameRef(v) ? await readFrame(v) : v, types.get(k) ?? fallbackTypes.get(k));
    }
    return vars;
  }

  async renderedBody(): Promise<string> {
    const src = this.templateSource();
    if (this._records) {
      const r = await renderKnapPages(src, this.templateVars, this._records, this.pageName);
      return r.pages.map((p) => p.body).join(PAGE_SEPARATOR);
    }
    return (await renderKnap(src, this.templateVars)).output;
  }

  data(inputs?: Record<string, unknown[]>): { document: DocumentValue | SolError } | Promise<{ document: DocumentValue | SolError }> {
    this._computed = true;
    const tpl = inputs?.template?.[0];
    this._templateDoc = isDocumentValue(tpl) ? tpl : null;
    this._recordsValue = inputs?.records?.[0] ?? null;
    this._recordsWired = inputs?.records !== undefined;
    const source = this.activeSource();

    const desired = this.hostVariables(source);
    if (!sameList(desired, this._refKeys)) this.reconcileInputs(desired);
    this.sideVars = this._templateDoc ? [...desired] : [];

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
      if (tplNote && hasKnapSyntax(source)) {
        await tplNote.data();
        const fresh = tplNote.fieldValues();
        for (const k of desired) if (inputs?.[k] === undefined && k in fresh) { refs[k] = fresh[k]; this._refValues.set(k, fresh[k] as never); }
      }
      this.templateVars = await this.templateVariables(refs, present, fallbackTypes);
      if (this._templateDoc) this.templateVars.template = source;
      if (recordsIn != null) {
        const raw = isFrameRef(recordsIn) ? await readFrame(recordsIn) : recordsIn;
        this._recordsFrame = raw;
        const rows = toTemplateValue(raw);
        this._records = Array.isArray(rows) ? rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r)) : [];
        this.templateVars.records = this._records;
        const r = await renderKnapPages(src, this.templateVars, this._records, this.pageName);
        if (r.errors.length) { this._pages = null; return { document: solError("#SYNTAX!", knapErrorText(r.errors)) }; }
        this._pages = r.pages;
        return { document: makeDocument(r.pages.map((p) => p.body).join(PAGE_SEPARATOR), refs, undefined, this.id, { pages: r.pages, total: r.total }) };
      }
      this._records = null; this._pages = null;
      const r = await renderKnap(src, this.templateVars);
      if (r.errors.length) return { document: solError("#SYNTAX!", knapErrorText(r.errors)) };
      return { document: makeDocument(r.output, refs, undefined, this.id) };
    })();
  }
}
