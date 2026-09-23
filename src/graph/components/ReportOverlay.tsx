// [[C68]] knapIsTheDocumentSyntax
import { usePendingDraft } from "../draftFlush";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import { ClassicPreset } from "rete";
import { reportStore } from "../reportStore";
import { siteChrome } from "../siteChrome";
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

const FILTERS = Object.entries(standardFilterMetadata)
  .map(([name, meta]) => ({ name, example: meta.example ?? name }))
  .sort((a, b) => a.name.localeCompare(b.name));
import { exportReportAsWebpage } from "../reportExport";
import "./Markdown.css";
import "./ReportOverlay.css";
import { renderNoteMarkdown } from "../noteMarkdown";
import { useKatexReady } from "./katexLoader";

const NO_VARS: Record<string, unknown> = {};

export function ReportOverlay() {
  const nodeId = useSyncExternalStore(reportStore.subscribe, reportStore.openNodeId);
  const docked = useSyncExternalStore(reportStore.subscribe, reportStore.isDocked);
  const chrome = useSyncExternalStore(siteChrome.subscribe, siteChrome.get);
  const editor = getEditor();
  const opened = nodeId ? editor?.getNode(nodeId) : undefined;
  const node = opened instanceof ReportNode ? opened : undefined;
  const note = opened instanceof NoteNode ? opened : undefined;

  const [body, setBody] = useState(node?.body ?? "");
  const [embedPickerOpen, setEmbedPickerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mobileTab, setMobileTab] = useState<"draft" | "preview">("draft");
  const embedBtnRef = useRef<HTMLButtonElement>(null);
  const embedPopRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(embedPickerOpen, () => setEmbedPickerOpen(false), [embedBtnRef, embedPopRef]);

  // The draft lives here until a commit writes node.body ([[C95]] commitOnEnter); a ref, so any close path can commit it.
  const draftRef = useRef(node?.body ?? "");
  const lastSyncRef = useRef(node?.body ?? "");
  // Debounced: re-parsing per keystroke remounted the whole preview (the scroll jumped, embeds re-mounted).
  const [previewBody, setPreviewBody] = useState(node?.body ?? "");
  useEffect(() => {
    setBody(node?.body ?? "");
    setPreviewBody(node?.body ?? "");
    draftRef.current = node?.body ?? "";
    lastSyncRef.current = node?.body ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);
  useEffect(() => {
    const t = setTimeout(() => setPreviewBody(body), 250);
    return () => clearTimeout(t);
  }, [body]);
  const [renderVersion, setRenderVersion] = useState(0);
  const wiredTemplate = node?.templateDoc ?? null;
  const previewSource = node ? node.templateSource(wiredTemplate ? node.activeSource() : previewBody) : "";
  const batch = useMemo<KnapBatch | null>(
    () => node?.records ? { records: node.records, pageName: node.pageName } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, node?.records, node?.pageName, renderVersion],
  );
  const { text: rendered, errors: templateErrors, pages } = useKnapRender(previewSource, node?.templateVars ?? NO_VARS, renderVersion, batch);
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = pages?.length ?? 0;
  const shownPage = pageCount ? Math.min(pageIndex, pageCount - 1) : 0;
  const recordTotal = node?.records?.length ?? 0;
  const capped = recordTotal > pageCount;
  const previewText = pages ? (pages[shownPage]?.body ?? "") : rendered;
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

  // No await needed: syncRefs runs synchronously before commitBody's first await, so the sockets still mint.
  function closeReport() {
    if (node) void commitBody();
    reportStore.close();
  }
  useEscapeToClose(closeReport, !!nodeId);

  const tex = useKatexReady();
  const bodyHtml = useMemo(
    () => DOMPurify.sanitize(renderNoteMarkdown(previewText || "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewText, tex],
  );

  const sourceRef = useRef<HTMLTextAreaElement>(null);

  const noteHtml = useMemo(
    () => note ? DOMPurify.sanitize(renderNoteMarkdown(parseNoteFrontmatter(note.body).body || "")) : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note, note?.body, tex],
  );

  if (!nodeId) return null;

  if (note) {
    const closeNote = () => reportStore.close();
    const notePanel = (
      <div className={`report-panel${docked ? " report-panel--docked" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="report-header">
          <span className="report-title">{note.label?.trim() || "Note"}</span>
          <div className="report-header-actions">
            {chrome.dock && (
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
            )}
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

  function onBody(v: string) { setBody(v); draftRef.current = v; }

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

  // Reads the draft ref, never the `body` state, so any close path can call it: mobile has no textarea blur.
  async function commitBody() {
    const current = draftRef.current;
    if (current === lastSyncRef.current) return;
    lastSyncRef.current = current;
    node!.body = current;
    scheduleAutosave();
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

  usePendingDraft(!!node && body !== lastSyncRef.current, () => void commitBody());

  const notes = (editor?.getNodes() ?? []).filter((n): n is NoteNode => n instanceof NoteNode);
  const names = nodeDisplayNames(editor?.getNodes() ?? []);
  const embeddable = notes;

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
    node!.body = draftRef.current;
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
            {docked && (
              <div className="report-viewtoggle" role="tablist">
                <button
                  type="button" role="tab" aria-selected={mobileTab === "draft"}
                  className={`report-viewtoggle__seg${mobileTab === "draft" ? " report-viewtoggle__seg--active" : ""}`}
                  onClick={() => setMobileTab("draft")}
                >Draft</button>
                <button
                  type="button" role="tab" aria-selected={mobileTab === "preview"}
                  className={`report-viewtoggle__seg${mobileTab === "preview" ? " report-viewtoggle__seg--active" : ""}`}
                  onClick={() => { void commitBody(); setMobileTab("preview"); }}
                >Preview</button>
              </div>
            )}
            <button
              ref={embedBtnRef}
              type="button"
              className="report-embed-btn"
              onClick={() => setEmbedPickerOpen((o) => !o)}
              disabled={embeddable.length === 0 || !!wiredTemplate}
              title={wiredTemplate ? "The wired template is the text" : embeddable.length === 0 ? "No Notes to embed" : "Embed a Note"}
            >
              Embed Note
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
            {chrome.export && (
              <button
                type="button"
                className="report-embed-btn"
                disabled={exporting}
                onClick={() => void doExport()}
                title="Export as a self-contained webpage. Refs are frozen to today's values. Charts and a canvas snapshot are inlined."
              >
                {exporting ? "Exporting…" : "Export"}
              </button>
            )}
            {/* Desktop only; on mobile the report is already full-screen. */}
            {chrome.dock && (
              <button
                className={`report-dock-btn${docked ? " report-dock-btn--on" : ""}`}
                onClick={() => reportStore.toggleDock()}
                title={docked ? "Undock to a floating panel" : "Dock to the right side"}
                aria-label={docked ? "Undock report" : "Dock report to the right"}
                aria-pressed={docked}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </button>
            )}
            <button className="report-close" onClick={() => closeReport()} title="Close (Esc)" aria-label="Close">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

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
              <pre className="fx-tokens" dangerouslySetInnerHTML={{ __html: highlightKnap(node.activeSource()) }} />
            </div>
          ) : (
          <div className="report-source">
          <pre ref={highlightRef} className="report-source__hl fx-tokens" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightKnap(body) }} />
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
            {batch && (
              <div className="report-pages">
                {pages && pageCount > 0 && (
                  <>
                    <button type="button" className="report-pages__step" disabled={shownPage === 0} onClick={() => setPageIndex(shownPage - 1)} aria-label="Previous page">‹</button>
                    <span className="report-pages__name" title={`${pages[shownPage].name}.md`}>{pages[shownPage].name}.md</span>
                    <span className="report-pages__count">{shownPage + 1} / {pageCount}</span>
                    <button type="button" className="report-pages__step" disabled={shownPage >= pageCount - 1} onClick={() => setPageIndex(shownPage + 1)} aria-label="Next page">›</button>
                    {capped && <span className="report-pages__cap">first {pageCount} of {recordTotal}</span>}
                  </>
                )}
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
              </div>
            )}
            {templateErrors ? (
              <pre className="report-preview__error">{templateErrors}</pre>
            ) : (pages ? pageCount > 0 : previewSource.trim()) ? (
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

  return docked ? panel : (
    <div className="report-backdrop" onPointerDown={() => closeReport()}>{panel}</div>
  );
}
