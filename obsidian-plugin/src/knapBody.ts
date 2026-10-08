// [[D87]] knapNotes
import { MarkdownRenderChild, MarkdownRenderer, MarkdownView, getFrontMatterInfo, parseYaml, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import { isKnapNote, knapVariables, renderKnapNote, renderKnapUnits, KNAP_PROPERTY, SPAN_RE, type KnapNoteRender, type KnapUnit } from "./knapNote";
import { knapLivePreview } from "./knapLive";
import type { PropertyKind } from "./yamlValue";

export interface KnapHost extends Plugin {
  objectKind(key: string): PropertyKind | undefined;
  chip(el: HTMLElement, kind: PropertyKind, key: string, value: unknown, onChange: (next: unknown) => void, sourcePath?: string): ShadowRoot;
  release(el: Element): void;
}

const KNAP_ON_RE = new RegExp(`^${KNAP_PROPERTY}\\s*:\\s*true\\s*$`, "m");

export interface LiveRender {
  path: string;
  frontmatter: Record<string, unknown>;
  /** `line:column message` lines, "" when the render succeeded. */
  error: string;
  errorAt: number;
  units: KnapUnit[];
}

export class KnapNotes {
  private renders = new Map<string, { key: string; render: Promise<KnapNoteRender> }>();

  constructor(readonly host: KnapHost) {}

  register(): void {
    this.host.registerMarkdownPostProcessor((el, ctx) => this.section(el, ctx));
    this.host.registerEvent(this.host.app.metadataCache.on("changed", (file, _data, cache) => this.changed(file.path, cache.frontmatter)));
    this.host.registerEditorExtension(knapLivePreview(this));
  }

  objectNames(frontmatter: Record<string, unknown>): string[] {
    return Object.keys(frontmatter).filter((key) => this.host.objectKind(key));
  }

  private render(path: string, text: string, frontmatter: Record<string, unknown>): Promise<KnapNoteRender> {
    const key = JSON.stringify([text, frontmatter]);
    const hit = this.renders.get(path);
    if (hit?.key === key) return hit.render;
    const render = knapVariables(frontmatter).then((vars) => renderKnapNote(text, vars, this.objectNames(frontmatter)));
    this.renders.set(path, { key, render });
    return render;
  }

  private async section(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const frontmatter: unknown = ctx.frontmatter;
    if (!isKnapNote(frontmatter)) return;
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const note = await this.render(ctx.sourcePath, info.text, frontmatter);
    const { lineStart: a, lineEnd: b } = info;
    if (a < note.bodyStart) return;
    const out = note.slice(a, b);
    const failedHere = note.errorLine >= a && note.errorLine <= b;
    const changed = out !== note.source(a, b);
    if (!changed && !failedHere) return;
    const child = new MarkdownRenderChild(el);
    ctx.addChild(child);
    if (changed) {
      el.empty();
      if (out.trim()) await MarkdownRenderer.render(this.host.app, out, el, ctx.sourcePath, child);
      this.chipsIn(el, ctx.sourcePath, frontmatter);
    }
    if (failedHere) el.createDiv({ cls: "solenoid-knap-error", text: note.error });
  }

  chipsIn(el: HTMLElement, path: string, frontmatter: Record<string, unknown>): void {
    for (const code of Array.from(el.querySelectorAll("code"))) {
      const name = SPAN_RE.exec(code.textContent ?? "")?.[1];
      const kind = name && name in frontmatter ? this.host.objectKind(name) : undefined;
      if (!name || !kind) continue;
      const span = (code.ownerDocument.win as typeof window).createSpan({ cls: "solenoid-knap-chip" });
      code.replaceWith(span);
      this.host.chip(span, kind, name, frontmatter[name], (next) => void this.write(path, name, next), path);
    }
  }

  async write(path: string, key: string, value: unknown): Promise<void> {
    const file = this.host.app.vault.getFileByPath(path);
    if (file) await this.host.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm[key] = value; });
  }

  /** What Live Preview draws for a note's text: each top-level piece's output, by offset; null when the note is not a Knap note. */
  async live(text: string, path: string): Promise<LiveRender | null> {
    const info = getFrontMatterInfo(text);
    if (!info.exists || !KNAP_ON_RE.test(info.frontmatter)) return null;
    let frontmatter: unknown;
    try { frontmatter = parseYaml(info.frontmatter); } catch { return null; }
    if (!isKnapNote(frontmatter)) return null;
    const vars = await knapVariables(frontmatter);
    const r = await renderKnapUnits(text.slice(info.contentStart), vars, this.objectNames(frontmatter));
    const error = r.failed ? (await renderKnapNote(text, vars, [])).error : "";
    const at = info.contentStart;
    return { path, frontmatter, error, errorAt: at, units: r.units.map((u) => ({ ...u, from: u.from + at, to: u.to + at })) };
  }

  /** A section drawn from one property can depend on any other, so a change redraws the whole note. */
  private changed(path: string, frontmatter: unknown): void {
    if (!this.renders.has(path) && !isKnapNote(frontmatter)) return;
    this.renders.delete(path);
    this.host.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path && view.getMode() === "preview") view.previewMode.rerender(true);
    });
  }
}
