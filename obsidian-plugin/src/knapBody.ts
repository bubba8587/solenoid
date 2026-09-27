// [[D87]] knapNotes
import { MarkdownRenderChild, MarkdownRenderer, MarkdownView, editorInfoField, editorLivePreviewField, getFrontMatterInfo, parseYaml, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { bareTags } from "../../src/graph/knapTemplate";
import { isKnapNote, knapVariables, renderKnapNote, KNAP_PROPERTY, type KnapNoteRender } from "./knapNote";
import type { PropertyKind } from "./yamlValue";

interface KnapHost extends Plugin {
  objectKind(key: string): PropertyKind | undefined;
  chip(el: HTMLElement, kind: PropertyKind, key: string, value: unknown, onChange: (next: unknown) => void): ShadowRoot;
  release(el: Element): void;
}

const SPAN_RE = /^=([A-Za-z_][A-Za-z0-9_]*)!?$/;
const KNAP_ON_RE = new RegExp(`^${KNAP_PROPERTY}\\s*:\\s*true\\s*$`, "m");

export class KnapNotes {
  private renders = new Map<string, { key: string; render: Promise<KnapNoteRender> }>();

  constructor(private host: KnapHost) {}

  register(): void {
    this.host.registerMarkdownPostProcessor((el, ctx) => this.section(el, ctx));
    this.host.registerEvent(this.host.app.metadataCache.on("changed", (file, _data, cache) => this.changed(file.path, cache.frontmatter)));
    this.host.registerEditorExtension(this.liveChips());
  }

  private objectNames(frontmatter: Record<string, unknown>): string[] {
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

  private chipsIn(el: HTMLElement, path: string, frontmatter: Record<string, unknown>): void {
    for (const code of Array.from(el.querySelectorAll("code"))) {
      const name = SPAN_RE.exec(code.textContent ?? "")?.[1];
      const kind = name && name in frontmatter ? this.host.objectKind(name) : undefined;
      if (!name || !kind) continue;
      const span = code.ownerDocument.createElement("span");
      span.className = "solenoid-knap-chip";
      code.replaceWith(span);
      this.host.chip(span, kind, name, frontmatter[name], (next) => void this.write(path, name, next));
    }
  }

  private async write(path: string, key: string, value: unknown): Promise<void> {
    const file = this.host.app.vault.getFileByPath(path);
    if (file) await this.host.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm[key] = value; });
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

  /** Live Preview shows the template; only a bare tag on an object property becomes its chip. */
  private liveChips() {
    const notes = this;

    class ChipWidget extends WidgetType {
      constructor(readonly kind: PropertyKind, readonly key: string, readonly value: unknown, readonly path: string) { super(); }

      eq(other: ChipWidget): boolean {
        return other.kind.id === this.kind.id && other.key === this.key && other.path === this.path
          && JSON.stringify(other.value) === JSON.stringify(this.value);
      }

      toDOM(view: EditorView): HTMLElement {
        const span = view.dom.ownerDocument.createElement("span");
        span.className = "solenoid-knap-chip";
        notes.host.chip(span, this.kind, this.key, this.value, (next) => void notes.write(this.path, this.key, next));
        return span;
      }

      destroy(dom: HTMLElement): void {
        notes.host.release(dom);
      }

      ignoreEvent(): boolean {
        return true;
      }
    }

    const build = (view: EditorView): DecorationSet => {
      const path = view.state.field(editorInfoField, false)?.file?.path;
      if (!path || !view.state.field(editorLivePreviewField, false)) return Decoration.none;
      const text = view.state.doc.toString();
      const info = getFrontMatterInfo(text);
      if (!info.exists || !KNAP_ON_RE.test(info.frontmatter)) return Decoration.none;
      let frontmatter: unknown;
      try { frontmatter = parseYaml(info.frontmatter); } catch { return Decoration.none; }
      if (!isKnapNote(frontmatter)) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      const { ranges } = view.state.selection;
      for (const tag of bareTags(text.slice(info.contentStart), this.objectNames(frontmatter))) {
        const from = info.contentStart + tag.from;
        const to = info.contentStart + tag.to;
        const kind = this.host.objectKind(tag.name);
        if (!kind || text.slice(from, to).includes("\n") || ranges.some((r) => r.from <= to && r.to >= from)) continue;
        builder.add(from, to, Decoration.replace({ widget: new ChipWidget(kind, tag.name, frontmatter[tag.name], path) }));
      }
      return builder.finish();
    };

    return ViewPlugin.fromClass(class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view);
      }

      update(update: ViewUpdate): void {
        const modeFlipped = update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false);
        if (update.docChanged || update.selectionSet || update.viewportChanged || modeFlipped) this.decorations = build(update.view);
      }
    }, { decorations: (plugin) => plugin.decorations });
  }
}
