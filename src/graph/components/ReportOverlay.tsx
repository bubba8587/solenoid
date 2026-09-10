import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ClassicPreset } from "rete";
import { reportStore } from "../reportStore";
import { getEditor, getView, processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { NoteNode, ReportNode } from "../rete-nodes";
import type { SolenoidConnection } from "../schemes";
import { nodeDisplayNames } from "../nodeNames";
import { nodeNameStore } from "../nodeNameStore";
import { parseNoteFrontmatter } from "../noteFrontmatter";
import { InlineRefBody } from "./inlineRefDisplay";
import { CloseIcon } from "./CloseIcon";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { useEscapeToClose } from "./useEscapeToClose";
import { useKnapRender, type KnapBatch } from "./useKnapRender";
import { highlightKnap } from "../knapHighlight";
import { standardFilterMetadata } from "knap";

/** The filter cheat-sheet's rows: every standard filter with its example call. */
const FILTERS = Object.entries(standardFilterMetadata)
  .map(([name, meta]) => ({ name, example: meta.example ?? name }))
  .sort((a, b) => a.name.localeCompare(b.name));
import { exportReportAsWebpage } from "../reportExport";
import "./Markdown.css";
import "./ReportOverlay.css";

const NO_VARS: Record<string, unknown> = {};

/** The Report's editing surface: markdown source + live preview. No WYSIWYG
 *  toolbar — that is the scope line the plan draws. Opened on a Note (plain or
 *  Obsidian) instead, the same panel shows the note read-only: a Document chip
 *  opens its source here whichever kind produced it. */
export function ReportOverlay() {
  const nodeId = useSyncExternalStore(reportStore.subscribe, reportStore.openNodeId);
  const docked = useSyncExternalStore(reportStore.subscribe, reportStore.isDocked);
  const editor = getEditor();
  const opened = nodeId ? editor?.getNode(nodeId) : undefined;
  const node = opened instanceof ReportNode ? opened : undefined;
  const note = opened instanceof NoteNode ? opened : undefined;

  const [body, setBody] = useState(node?.body ?? "");
  const [embedPickerOpen, setEmbedPickerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Mobile only: the split pane becomes Draft/Preview tabs; ignored on desktop.
  const [mobileTab, setMobileTab] = useState<"draft" | "preview">("draft");
  const embedBtnRef = useRef<HTMLButtonElement>(null);
  const embedPopRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(embedPickerOpen, () => setEmbedPickerOpen(false), [embedBtnRef, embedPopRef]);

  // Reset the draft on nodeId ONLY, never node.body: onBody writes it live, so a
  // body dependency would clobber lastSyncRef mid-typing and the sockets never mint.
  const lastSyncRef = useRef(node?.body ?? "");
  // The preview renders from a DEBOUNCED copy — re-parsing per keystroke tore down
  // and remounted the whole rendered pane (scroll jumped, embeds re-mounted).
  const [previewBody, setPreviewBody] = useState(node?.body ?? "");
  useEffect(() => {
    setBody(node?.body ?? "");
    setPreviewBody(node?.body ?? "");
    lastSyncRef.current = node?.body ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);
  useEffect(() => {
    const t = setTimeout(() => setPreviewBody(body), 250);
    return () => clearTimeout(t);
  }, [body]);
  // The Knap render of the draft against the variables the graph last fed the node;
  // `renderVersion` re-runs it after a commit recomputes them.
  const [renderVersion, setRenderVersion] = useState(0);
  // With a template wired the source pane is the wired note's text, read-only;
  // with records wired the preview is the merge's pages.
  const wiredTemplate = node?.templateDoc ?? null;
  const previewSource = node ? node.templateSource(wiredTemplate ? node.activeSource() : previewBody) : "";
  const batch = useMemo<KnapBatch | null>(
    () => node?.records ? { records: node.records, pageName: node.pageName } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, node?.records, node?.pageName, renderVersion],
  );
  const { text: rendered, errors: templateErrors, pages } = useKnapRender(previewSource, node?.templateVars ?? NO_VARS, renderVersion, batch);
  // A merge previews ONE page at a time, stepped from the preview's header.
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = pages?.length ?? 0;
  const shownPage = pageCount ? Math.min(pageIndex, pageCount - 1) : 0;
  const previewText = pages ? (pages[shownPage]?.body ?? "") : rendered;
  // The filters cheat-sheet: click a row to insert `| filter` at the cursor.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const filtersPopRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(filtersOpen, () => setFiltersOpen(false), [filtersBtnRef, filtersPopRef]);
  const highlightRef = useRef<HTMLPreElement>(null);
  const [pageName, setPageName] = useState(node?.pageName ?? "");
  useEffect(() => { setPageName(node?.pageName ?? ""); }, [node, nodeId]);
  async function commitPageName() {
    if (!node || node.pageName === pageName) return;
    node.pageName = pageName;
    scheduleAutosave();
    await processGraph();
    setRenderVersion((v) => v + 1);
  }

  // Commit THEN close: syncRefs runs synchronously before commitBody's first await,
  // so the sockets mint even though this doesn't await.
  function closeReport() {
    if (node) void commitBody();
    reportStore.close();
  }
  useEscapeToClose(closeReport, !!nodeId);

  const bodyHtml = useMemo(
    () => DOMPurify.sanitize(
      marked.parse(previewText || "", { async: false, gfm: true, breaks: true }) as string,
    ),
    [previewText],
  );

  const sourceRef = useRef<HTMLTextAreaElement>(null);

  // A Note's body is rendered exactly as its card renders it: frontmatter stripped,
  // sanitized on every render (a body arrives in shared .solenoid files).
  const noteHtml = useMemo(
    () => note ? DOMPurify.sanitize(marked.parse(parseNoteFrontmatter(note.body).body || "", { async: false, gfm: true, breaks: true }) as string) : "",
    [note, note?.body],
  );

  if (!nodeId) return null;

  if (note) {
    const closeNote = () => reportStore.close();
    const notePanel = (
      <div className={`report-panel${docked ? " report-panel--docked" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="report-header">
          <span className="report-title">{note.label?.trim() || "Note"}</span>
          <div className="report-header-actions">
            <button
              className={`report-dock-btn${docked ? " report-dock-btn--on" : ""}`}
              onClick={() => reportStore.toggleDock()}
              title={docked ? "Undock to a floating panel" : "Dock to the right side"}
              aria-label={docked ? "Undock note" : "Dock note to the right"}
              aria-pressed={docked}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M15 3v18" />
              </svg>
            </button>
            <button className="report-close" onClick={closeNote} title="Close (Esc)" aria-label="Close">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
        <div className="report-body">
          <div className="report-preview report-preview--solo sol-md">
            {noteHtml.trim()
              ? <div className="report-preview__md" dangerouslySetInnerHTML={{ __html: noteHtml }} />
              : <div className="report-preview__empty">Empty note</div>}
          </div>
        </div>
      </div>
    );
    return docked ? notePanel : (
      <div className="report-backdrop" onPointerDown={closeNote}>{notePanel}</div>
    );
  }

  if (!node) return null;

  function onBody(v: string) { setBody(v); node!.body = v; scheduleAutosave(); }

  /** Insert text at the source pane's cursor (or the end) and keep the caret after it. */
  function insertAtCursor(text: string) {
    const ta = sourceRef.current;
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + text + body.slice(end);
    onBody(next);
    if (ta) requestAnimationFrame(() => { const pos = start + text.length; ta.focus(); ta.setSelectionRange(pos, pos); });
  }

  function insertFilter(example: string) {
    insertAtCursor(` | ${example}`);
    setFiltersOpen(false);
  }

  // Mints the template-variable sockets. Must read node.body, not the `body` state, so any
  // close path can call it without a stale closure — mobile has no textarea blur.
  async function commitBody() {
    const current = node!.body;
    if (current === lastSyncRef.current) return;
    lastSyncRef.current = current;
    const { removedInputs } = node!.syncRefs();
    const ed = getEditor();
    if (ed && removedInputs.length) {
      for (const c of ed.getConnections()) {
        if (c.target === node!.id && removedInputs.includes(c.targetInput)) {
          await ed.removeConnection(c.id);
        }
      }
    }
    await getView()?.rerenderNode(node!.id);
    await processGraph();
    setRenderVersion((v) => v + 1);
  }

  const notes = (editor?.getNodes() ?? []).filter((n): n is NoteNode => n instanceof NoteNode);
  const names = nodeDisplayNames(editor?.getNodes() ?? []);
  // Every Note stays insertable: placement is a bare `{{ name }}` tag like any value's.
  const embeddable = notes;

  // Inserts a bare `{{ name }}` at the cursor (the note's ADDRESSABLE name — the
  // identifier grammar), mints the input, and wires the note's Document output into
  // it. From there it is an ordinary cable: the embed is a dependency the graph can
  // see, prune, and recompute.
  async function addEmbed(id: string) {
    const note = editor?.getNode(id) as NoteNode | undefined;
    if (!note) return;
    const refName = nodeNameStore.ensure(id, "NoteNode");
    const ta = sourceRef.current;
    const token = `{{ ${refName} }}`;
    if (ta) {
      const start = ta.selectionStart ?? body.length;
      const end = ta.selectionEnd ?? body.length;
      const before = body.slice(0, start);
      const needsNL = before.length > 0 && !before.endsWith("\n\n");
      const insert = `${needsNL ? "\n\n" : ""}${token}\n\n`;
      const next = before + insert + body.slice(end);
      onBody(next);
      requestAnimationFrame(() => {
        const pos = (before + insert).length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    } else {
      onBody(`${body}${body.endsWith("\n") || body === "" ? "" : "\n\n"}${token}\n`);
    }
    setEmbedPickerOpen(false);
    node!.syncRefs(); // mint the input now so the wire has a socket
    const ed = getEditor();
    if (ed && !ed.getConnections().some((c) => c.target === node!.id && c.targetInput === refName)) {
      await ed.addConnection(new ClassicPreset.Connection(note, "document", node!, refName) as SolenoidConnection);
    }
    lastSyncRef.current = node!.body;
    scheduleAutosave();
    await getView()?.rerenderNode(node!.id);
    await processGraph();
  }

  async function doExport() {
    if (exporting) return;
    setExporting(true);
    try {
      await exportReportAsWebpage(node!);
    } finally {
      setExporting(false);
    }
  }

  const panel = (
    <div className={`report-panel${docked ? " report-panel--docked" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="report-header">
          <span className="report-title">{node.label?.trim() || "Report"}</span>
          <div className="report-header-actions">
            {batch && (
              <label className="report-page-name" title="Knap for each page's note name, with record and index. Blank names pages by index.">
                <span>Page name</span>
                <input
                  value={pageName}
                  placeholder="{{ record.Name }}"
                  spellCheck={false}
                  onChange={(e) => setPageName(e.target.value)}
                  onBlur={() => void commitPageName()}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                />
              </label>
            )}
            <button
              ref={embedBtnRef}
              type="button"
              className="report-embed-btn"
              onClick={() => setEmbedPickerOpen((o) => !o)}
              disabled={embeddable.length === 0 || !!wiredTemplate}
              title={wiredTemplate ? "The wired template is the text" : embeddable.length === 0 ? "No Notes to embed" : "Embed a Note"}
            >
              Embed a Note
            </button>
            {embedPickerOpen && (
              <div ref={embedPopRef} className="report-embed-picker">
                {embeddable.map((n) => (
                  <button key={n.id} type="button" className="report-embed-opt" onClick={() => void addEmbed(n.id)}>
                    {names.get(n.id) ?? "Note"}
                  </button>
                ))}
              </div>
            )}
            <button
              ref={filtersBtnRef}
              type="button"
              className="report-embed-btn"
              disabled={!!wiredTemplate}
              onClick={() => setFiltersOpen((o) => !o)}
              title={wiredTemplate ? "The wired template is the text" : "Knap filters. Insert one at the cursor"}
            >
              Filters
            </button>
            {filtersOpen && (
              <div ref={filtersPopRef} className="report-embed-picker report-filters">
                <input
                  className="report-filters__search"
                  value={filterQuery}
                  placeholder="Filter"
                  spellCheck={false}
                  autoFocus
                  onChange={(e) => setFilterQuery(e.target.value)}
                />
                <div className="report-filters__list">
                  {FILTERS.filter((f) => f.name.includes(filterQuery.trim().toLowerCase())).map((f) => (
                    <button key={f.name} type="button" className="report-embed-opt report-filters__opt" onClick={() => insertFilter(f.example)}>
                      <span className="report-filters__name">{f.name}</span>
                      <code>{f.example}</code>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              className="report-embed-btn"
              disabled={exporting}
              onClick={() => void doExport()}
              title="Export as a self-contained webpage. Refs are frozen to today's values. Charts and a canvas snapshot are inlined."
            >
              {exporting ? "Exporting…" : "Export as webpage"}
            </button>
            {/* Dock to / undock from the right side of the page (desktop only —
                CSS-hidden on mobile, where the report is already full-screen). */}
            <button
              className={`report-dock-btn${docked ? " report-dock-btn--on" : ""}`}
              onClick={() => reportStore.toggleDock()}
              title={docked ? "Undock to a floating panel" : "Dock to the right side"}
              aria-label={docked ? "Undock report" : "Dock report to the right"}
              aria-pressed={docked}
            >
              {/* Lucide panel-right — a box with a right-hand panel. */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M15 3v18" />
              </svg>
            </button>
            <button className="report-close" onClick={() => closeReport()} title="Close (Esc)" aria-label="Close">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

        {/* Mobile tab bar, CSS-hidden on desktop. */}
        <div className="report-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "draft"}
            className={`report-tab${mobileTab === "draft" ? " report-tab--active" : ""}`}
            onClick={() => setMobileTab("draft")}
          >
            Draft
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "preview"}
            className={`report-tab${mobileTab === "preview" ? " report-tab--active" : ""}`}
            onClick={() => { void commitBody(); setMobileTab("preview"); }}
          >
            Preview
          </button>
        </div>

        <div className="report-body" data-tab={mobileTab}>
          {wiredTemplate ? (
            <div className="report-source report-source--wired">
              <div className="report-source__hint">Template from the wired Note. Edit it there.</div>
              <pre>{node.activeSource()}</pre>
            </div>
          ) : (
          <div className="report-source">
          <pre ref={highlightRef} className="report-source__hl" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightKnap(body) }} />
          <textarea
            ref={sourceRef}
            className="report-source__ta"
            value={body}
            placeholder={'Write in markdown. {{ name }} shows a wired value, a chart, a table, or a wired Note whole; {{ name | date:"D MMM" }} formats it, {% for row in table %} repeats, {% if %} gates. Records makes it a mail merge: one page per record.'}
            spellCheck={false}
            onChange={(e) => onBody(e.target.value)}
            onBlur={() => void commitBody()}
            onScroll={(e) => { const h = highlightRef.current; if (h) { h.scrollTop = e.currentTarget.scrollTop; h.scrollLeft = e.currentTarget.scrollLeft; } }}
          />
          </div>
          )}
          <div className="report-preview sol-md">
            {pages && pageCount > 0 && (
              <div className="report-pages">
                <button type="button" className="report-pages__step" disabled={shownPage === 0} onClick={() => setPageIndex(shownPage - 1)} aria-label="Previous page">‹</button>
                <span className="report-pages__name" title={`${pages[shownPage].name}.md`}>{pages[shownPage].name}.md</span>
                <span className="report-pages__count">{shownPage + 1} / {pageCount}</span>
                <button type="button" className="report-pages__step" disabled={shownPage >= pageCount - 1} onClick={() => setPageIndex(shownPage + 1)} aria-label="Next page">›</button>
              </div>
            )}
            {templateErrors ? (
              <pre className="report-preview__error">{templateErrors}</pre>
            ) : (pages ? pageCount > 0 : previewBody.trim()) ? (
              <InlineRefBody
                nodeId={node.id}
                bodyHtml={bodyHtml}
                className="report-preview__md"
                collapsibleEmbeds
              />
            ) : (
              <div className="report-preview__empty">Preview</div>
            )}
          </div>
        </div>
      </div>
  );

  // Docked drops the backdrop so the canvas stays interactive.
  return docked ? panel : (
    <div className="report-backdrop" onPointerDown={() => closeReport()}>{panel}</div>
  );
}
