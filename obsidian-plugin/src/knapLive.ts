// [[D87]] knapNotes
import { Component, MarkdownRenderer, editorInfoField, editorLivePreviewField } from "obsidian";
import { syntaxTree } from "@codemirror/language";
import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { SPAN_RE, type KnapUnit } from "./knapNote";
import type { KnapNotes, LiveRender } from "./knapBody";
import type { PropertyKind } from "./yamlValue";

const setLive = StateEffect.define<LiveRender | null>();

/** A piece shows its source again when the selection touches it. */
const touches = (state: EditorState, from: number, to: number) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);

/** Offsets move with an edit; a piece the edit lands in shows its source until the next render. */
function mapLive(live: LiveRender, tr: Transaction): LiveRender {
  const edited = (u: KnapUnit) => {
    let hit = false;
    tr.changes.iterChangedRanges((from, to) => { if (from <= u.to && to >= u.from) hit = true; });
    return hit;
  };
  return {
    ...live,
    errorAt: tr.changes.mapPos(live.errorAt),
    units: live.units.filter((u) => !edited(u)).map((u) => ({ ...u, from: tr.changes.mapPos(u.from, 1), to: tr.changes.mapPos(u.to, -1) })),
  };
}

const MARKS = ["strong", "em", "highlight", "strikethrough"];

/** Obsidian styles bold, italic, highlight and strikethrough on the text, so a value standing in for text takes them from the syntax around it. */
function marksAt(state: EditorState, pos: number): string {
  const names = new Set<string>();
  for (let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent as typeof node) {
    for (const part of node.name.split(/[_ ]/)) names.add(part);
  }
  return MARKS.filter((m) => names.has(m)).map((m) => `cm-${m}`).join(" ");
}

interface Group { from: number; to: number; block: boolean; units: KnapUnit[] }

/** A piece that spans lines, or whose output does, takes its whole lines, and every piece on them. */
function groups(state: EditorState, units: readonly KnapUnit[]): Group[] {
  const out: Group[] = [];
  for (const u of units) {
    const block = state.doc.sliceString(u.from, u.to).includes("\n") || u.output.includes("\n");
    let g: Group = block
      ? { from: state.doc.lineAt(u.from).from, to: state.doc.lineAt(u.to).to, block, units: [u] }
      : { from: u.from, to: u.to, block, units: [u] };
    while (out.length && g.from <= out[out.length - 1].to && (g.block || out[out.length - 1].block)) {
      const prev = out.pop()!;
      g = { from: Math.min(prev.from, g.from), to: Math.max(prev.to, g.to), block: true, units: [...prev.units, ...g.units] };
    }
    out.push(g);
  }
  return out;
}

export function knapLivePreview(notes: KnapNotes) {
  const app = notes.host.app;

  /** Renders markdown into `el` under a component the widget's `destroy` unloads. */
  const components = new WeakMap<HTMLElement, Component>();
  const renderInto = (el: HTMLElement, md: string, path: string, then?: () => void) => {
    const component = new Component();
    component.load();
    components.set(el, component);
    void MarkdownRenderer.render(app, md, el, path, component).then(then);
  };
  const unload = (el: HTMLElement) => {
    components.get(el)?.unload();
    notes.host.release(el);
  };

  class ValueWidget extends WidgetType {
    constructor(readonly md: string, readonly path: string, readonly marks: string) { super(); }

    eq(other: ValueWidget): boolean { return other.md === this.md && other.path === this.path && other.marks === this.marks; }

    toDOM(view: EditorView): HTMLElement {
      const span = (view.dom.ownerDocument.win as typeof window).createSpan();
      span.className = `solenoid-knap-value ${this.marks}`.trim();
      if (!/[*_`[\]<>#|~=!$\\]/.test(this.md)) {
        span.textContent = this.md;
        return span;
      }
      renderInto(span, this.md, this.path, () => {
        const only = span.children.length === 1 ? span.firstElementChild : null;
        if (only?.tagName === "P") only.replaceWith(...Array.from(only.childNodes));
      });
      return span;
    }

    destroy(dom: HTMLElement): void { unload(dom); }
  }

  class ChipWidget extends WidgetType {
    constructor(readonly kind: PropertyKind, readonly key: string, readonly value: unknown, readonly path: string) { super(); }

    eq(other: ChipWidget): boolean {
      return other.kind.id === this.kind.id && other.key === this.key && other.path === this.path
        && JSON.stringify(other.value) === JSON.stringify(this.value);
    }

    toDOM(view: EditorView): HTMLElement {
      const span = (view.dom.ownerDocument.win as typeof window).createSpan();
      span.className = "solenoid-knap-chip";
      notes.host.chip(span, this.kind, this.key, this.value, (next) => void notes.write(this.path, this.key, next));
      return span;
    }

    destroy(dom: HTMLElement): void { notes.host.release(dom); }

    ignoreEvent(): boolean { return true; }
  }

  class BlockWidget extends WidgetType {
    constructor(readonly md: string, readonly live: LiveRender) { super(); }

    eq(other: BlockWidget): boolean {
      return other.md === this.md && other.live.path === this.live.path
        && JSON.stringify(other.live.frontmatter) === JSON.stringify(this.live.frontmatter);
    }

    toDOM(view: EditorView): HTMLElement {
      const div = (view.dom.ownerDocument.win as typeof window).createDiv();
      div.className = "solenoid-knap-block markdown-rendered";
      renderInto(div, this.md, this.live.path, () => notes.chipsIn(div, this.live.path, this.live.frontmatter));
      return div;
    }

    destroy(dom: HTMLElement): void { unload(dom); }

    /** A press on a chip is the chip's; anywhere else puts the cursor in, which shows the source. */
    ignoreEvent(event: Event): boolean {
      return event.target instanceof Element && !!event.target.closest(".solenoid-knap-chip");
    }
  }

  class ErrorWidget extends WidgetType {
    constructor(readonly error: string) { super(); }

    eq(other: ErrorWidget): boolean { return other.error === this.error; }

    toDOM(view: EditorView): HTMLElement {
      const div = (view.dom.ownerDocument.win as typeof window).createDiv();
      div.className = "solenoid-knap-error";
      div.textContent = this.error;
      return div;
    }
  }

  const chipOf = (live: LiveRender, output: string) => {
    const span = /^`([^`]*)`$/.exec(output)?.[1];
    const name = span ? SPAN_RE.exec(span)?.[1] : undefined;
    const kind = name && name in live.frontmatter ? notes.host.objectKind(name) : undefined;
    return name && kind ? new ChipWidget(kind, name, live.frontmatter[name], live.path) : null;
  };

  const build = (state: EditorState, live: LiveRender): { deco: DecorationSet; blocks: Group[] } => {
    const builder = new RangeSetBuilder<Decoration>();
    const blocks: Group[] = [];
    if (live.error) builder.add(live.errorAt, live.errorAt, Decoration.widget({ widget: new ErrorWidget(live.error), block: true, side: -1 }));
    for (const g of groups(state, live.units)) {
      if (touches(state, g.from, g.to)) continue;
      if (!g.block) {
        const u = g.units[0];
        if (u.output === state.doc.sliceString(u.from, u.to)) continue;
        builder.add(u.from, u.to, Decoration.replace({ widget: chipOf(live, u.output) ?? new ValueWidget(u.output, live.path, marksAt(state, u.from)) }));
        continue;
      }
      let md = "";
      let at = g.from;
      for (const u of g.units) {
        md += state.doc.sliceString(at, u.from) + u.output;
        at = u.to;
      }
      md = (md + state.doc.sliceString(at, g.to)).trim();
      blocks.push(g);
      builder.add(g.from, g.to, md ? Decoration.replace({ widget: new BlockWidget(md, live), block: true }) : Decoration.replace({ block: true }));
    }
    return { deco: builder.finish(), blocks };
  };

  const field = StateField.define<{ live: LiveRender | null; deco: DecorationSet; blocks: Group[] }>({
    create: () => ({ live: null, deco: Decoration.none, blocks: [] }),
    update(value, tr) {
      let live = value.live;
      for (const e of tr.effects) if (e.is(setLive)) live = e.value;
      if (live && tr.docChanged) live = mapLive(live, tr);
      const on = tr.state.field(editorLivePreviewField, false) ?? false;
      const flipped = on !== (tr.startState.field(editorLivePreviewField, false) ?? false);
      if (live === value.live && !tr.selection && !flipped) return value;
      return { live, ...(live && on ? build(tr.state, live) : { deco: Decoration.none, blocks: [] }) };
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.deco),
  });

  /** Renders the note after an edit settles and hands the result to the field. A half-typed tag fails to render, so
   *  an error waits until the edits pause for ERROR_WAIT; until then the pieces keep their last output. */
  const ERROR_WAIT = 1500;
  const renderer = ViewPlugin.fromClass(class {
    private timer = 0;
    private gone = false;
    private edited = 0;

    constructor(private view: EditorView) {
      this.schedule(0);
    }

    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      this.edited = Date.now();
      this.schedule(150);
    }

    destroy(): void {
      this.gone = true;
      window.clearTimeout(this.timer);
    }

    private schedule(ms: number): void {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.run(), ms);
    }

    private async run(): Promise<void> {
      const path = this.view.state.field(editorInfoField, false)?.file?.path;
      const text = this.view.state.doc.toString();
      const live = path ? await notes.live(text, path) : null;
      if (this.gone || this.view.state.doc.toString() !== text) return;
      const quiet = Date.now() - this.edited;
      if (live?.error && quiet < ERROR_WAIT) return this.schedule(ERROR_WAIT - quiet);
      if (!live && !this.view.state.field(field).live) return;
      this.view.dispatch({ effects: setLive.of(live) });
    }
  });

  /** Up or down onto a drawn block puts the cursor in it, which shows its source; the editor would step over it. */
  const enterBlock = (down: boolean) => (view: EditorView): boolean => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty) return false;
    const line = state.doc.lineAt(sel.head);
    const n = line.number + (down ? 1 : -1);
    if (n < 1 || n > state.doc.lines) return false;
    const next = state.doc.line(n);
    const g = state.field(field).blocks.find((b) => (down ? b.from === next.from : b.to === next.to));
    if (!g) return false;
    view.dispatch({ selection: { anchor: down ? g.from : g.to }, scrollIntoView: true });
    return true;
  };

  return [field, renderer, Prec.highest(keymap.of([{ key: "ArrowDown", run: enterBlock(true) }, { key: "ArrowUp", run: enterBlock(false) }]))];
}
