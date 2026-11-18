// [[reports-and-notes#HTML pages]], [[C68]] knapIsTheDocumentSyntax
import { GraphNode } from "../graphModel";
import { trueAnyIn } from "./shared";
import { getOwningView } from "../activeGraph";
import { dropInputCables } from "../components/cablePrune";
import { embedBareVariables, extractKnapVariables, knapErrorText, renderKnapHtml } from "../knapTemplate";
import { toTemplateValue } from "../templateValue";
import { isFrameRef, readFrame } from "../frameBackend";
import { hasFs, readFileText } from "../fileBridge";
import { getCsvFolder, isDemoVaultPath } from "../demoVault";
import { connectionStore } from "../connectionStore";
import { solError, type SolError } from "../errorValue";
import { pageParts, scopeCss, slotsFor } from "../htmlPageText";

/** The page as the last compute left it: its body with a slot per bare tag (unsanitized: the overlay sanitizes it as it
 *  draws), its CSS scoped, or what kept it from rendering. */
export interface HtmlPageRender {
  body: string;
  css: string;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export class HtmlPageNode extends GraphNode {
  static socketDocs: Record<string, string> = {};

  label: string;
  /** The page's HTML file, in the data folder (Settings ▸ Data). */
  fileName: string;
  /** Its stylesheet, in the same folder; blank for none. */
  styleFile: string;
  /** The page's variables as of the last compute, persisted so a saved cable finds its socket before the files are read. */
  sideVars: string[];
  collapsed: boolean;
  width = 220; height = 120;

  render: HtmlPageRender | null = null;
  error: SolError | null = null;

  private _refKeys: string[];
  private _values = new Map<string, unknown>();
  private _key: string | undefined;
  private _files: { html: string; css: string } | null = null;

  constructor(init?: { label?: string; fileName?: string; styleFile?: string; sideVars?: string[]; collapsed?: boolean }) {
    super("HtmlPage");
    this.label = init?.label ?? "HTML Page";
    this.fileName = typeof init?.fileName === "string" ? init.fileName : "";
    this.styleFile = typeof init?.styleFile === "string" ? init.styleFile : "";
    this.sideVars = Array.isArray(init?.sideVars) ? init.sideVars.filter((v): v is string => typeof v === "string") : [];
    this.collapsed = init?.collapsed ?? false;
    this._refKeys = [...this.sideVars];
    for (const k of this._refKeys) this.addInput(k, trueAnyIn(k));
  }

  /** One input per variable the page reads, in first-use order. */
  refKeys(): string[] {
    return [...this._refKeys];
  }

  refValue(key: string): unknown {
    return this._values.get(key);
  }

  private reconcileInputs(desired: string[]): void {
    const added = desired.filter((k) => !this.inputs[k]);
    const removed = Object.keys(this.inputs).filter((k) => !desired.includes(k));
    this._refKeys = desired;
    this.sideVars = [...desired];
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

  /** The two files, read again only when a name, the folder or a Refresh changes. */
  private async files(): Promise<{ html: string; css: string } | SolError | null> {
    const folder = getCsvFolder();
    const page = this.fileName.trim();
    const style = this.styleFile.trim();
    if (!page) return null;
    if (!hasFs() && !isDemoVaultPath(folder)) return solError("#REF!", "Local files are read in the desktop app, or from the demo vault");
    if (!folder) return solError("#REF!", "No data folder: choose one in Settings ▸ Data");
    const key = connectionStore.key(this.id, `${folder}\u0000${page}\u0000${style}`);
    if (key === this._key && this._files) return this._files;
    try {
      const [html, css] = await Promise.all([readFileText(folder, page), style ? readFileText(folder, style) : Promise.resolve("")]);
      this._files = { html, css };
      this._key = key;
      return this._files;
    } catch {
      this._files = null;
      this._key = undefined;
      return solError("#REF!", `Can't read ${page}${style ? ` or ${style}` : ""} in the data folder`);
    }
  }

  async data(inputs?: Record<string, unknown[]>): Promise<Record<string, never>> {
    const files = await this.files();
    const source = files && !("code" in files) ? files.html : "";
    const parts = pageParts(source);
    const desired = files && !("code" in files) ? extractKnapVariables(parts.body) : this._refKeys;
    if (!sameList(desired, this._refKeys)) this.reconcileInputs(desired);
    this._values = new Map(desired.map((k) => [k, inputs?.[k] !== undefined ? (inputs[k][0] ?? null) : undefined]));
    if (!files || "code" in files) {
      this.render = null;
      this.error = files;
      return {};
    }
    const vars: Record<string, unknown> = {};
    for (const [k, v] of this._values) if (v !== undefined) vars[k] = toTemplateValue(isFrameRef(v) ? await readFrame(v) : v);
    const wired = desired.filter((k) => this._values.get(k) !== undefined);
    const r = await renderKnapHtml(embedBareVariables(parts.body, wired), vars);
    if (r.errors.length) {
      this.render = null;
      this.error = solError("#SYNTAX!", knapErrorText(r.errors));
      return {};
    }
    this.error = null;
    this.render = { body: slotsFor(r.output), css: scopeCss([...parts.styles, files.css].join("\n")) };
    return {};
  }
}
