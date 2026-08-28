import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ClassicPreset } from "rete";
import { reportStore } from "../reportStore";
import { getEditor, getArea, processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { NoteNode, ReportNode } from "../rete-nodes";
import type { SolenoidConnection } from "../schemes";
import { nodeDisplayNames } from "../nodeNames";
import { nodeNameStore } from "../nodeNameStore";
import { InlineRefBody } from "./inlineRefDisplay";
import { CloseIcon } from "./CloseIcon";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { useEscapeToClose } from "./useEscapeToClose";
import { exportReportAsWebpage } from "../reportExport";
import "./Markdown.css";
import "./ReportOverlay.css";

/** The Report's editing surface: markdown source + live preview. No WYSIWYG
 *  toolbar — that is the scope line the plan draws. */
export function ReportOverlay() {
  const nodeId = useSyncExternalStore(reportStore.subscribe, reportStore.openNodeId);
  const docked = useSyncExternalStore(reportStore.subscribe, reportStore.isDocked);
  const editor = getEditor();
  const node = nodeId ? (editor?.getNode(nodeId) as ReportNode | undefined) : undefined;

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

  // Commit THEN close: syncRefs runs synchronously before commitBody's first await,
  // so the sockets mint even though this doesn't await.
  function closeReport() {
    void commitBody();
    reportStore.close();
  }
  useEscapeToClose(closeReport, !!nodeId);

  const bodyHtml = useMemo(
    () => DOMPurify.sanitize(
      marked.parse(previewBody || "", { async: false, gfm: true, breaks: true }) as string,
    ),
    [previewBody],
  );

  const sourceRef = useRef<HTMLTextAreaElement>(null);

  if (!nodeId || !node) return null;

  function onBody(v: string) { setBody(v); node!.body = v; scheduleAutosave(); }

  // Mints the `=name` ref sockets. Must read node.body, not the `body` state, so any
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
    await getArea()?.rerenderNode(node!.id);
    await processGraph();
  }

  const notes = (editor?.getNodes() ?? []).filter((n): n is NoteNode => n instanceof NoteNode);
  const names = nodeDisplayNames(editor?.getNodes() ?? []);
  // Every Note stays insertable: placement is a `=name` ref token like any value's.
  const embeddable = notes;

  // Inserts a `` `=name` `` ref at the cursor (the note's ADDRESSABLE name — the
  // token grammar is the identifier grammar), mints the ref input, and wires the
  // note's Document output into it. From there it is an ordinary cable: the embed
  // is a dependency the graph can see, prune, and recompute.
  async function addEmbed(id: string) {
    const note = editor?.getNode(id) as NoteNode | undefined;
    if (!note) return;
    const refName = nodeNameStore.ensure(id, "NoteNode");
    const ta = sourceRef.current;
    const token = `\`=${refName}\``;
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
    await getArea()?.rerenderNode(node!.id);
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
            <button
              ref={embedBtnRef}
              type="button"
              className="report-embed-btn"
              onClick={() => setEmbedPickerOpen((o) => !o)}
              disabled={embeddable.length === 0}
              title={embeddable.length === 0 ? "No Notes to embed" : "Embed a Note"}
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
          <textarea
            ref={sourceRef}
            className="report-source"
            value={body}
            placeholder="Write in markdown. `=name` shows a wired value; a wired Note embeds whole."
            spellCheck={false}
            onChange={(e) => onBody(e.target.value)}
            onBlur={() => void commitBody()}
          />
          <div className="report-preview sol-md">
            {previewBody.trim() ? (
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
