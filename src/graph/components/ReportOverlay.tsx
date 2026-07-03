import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { reportStore } from "../reportStore";
import { getEditor, getArea, processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { NoteNode, ReportNode } from "../rete-nodes";
import { nodeDisplayNames } from "../nodeNames";
import { InlineRefBody } from "./inlineRefDisplay";
import { CloseIcon } from "./CloseIcon";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { exportReportAsWebpage } from "../reportExport";
import "./Markdown.css";
import "./ReportOverlay.css";

/**
 * The Report's real editing surface — a standalone full-screen document, separate
 * from the graph's node cards (bundle 13 #13). Plain markdown source (left) + a
 * live preview (right) that renders inline `` `=name` `` refs with their connected
 * value via the SAME InlineRefBody component the Note card uses, plus a strip of
 * embedded Notes (read-only mini previews of an existing Note node, placed as
 * objects). No WYSIWYG toolbar — that's the scope line the plan draws.
 */
export function ReportOverlay() {
  const nodeId = useSyncExternalStore(reportStore.subscribe, reportStore.openNodeId);
  const editor = getEditor();
  const node = nodeId ? (editor?.getNode(nodeId) as ReportNode | undefined) : undefined;

  const [body, setBody] = useState(node?.body ?? "");
  const [embedPickerOpen, setEmbedPickerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const embedBtnRef = useRef<HTMLButtonElement>(null);
  const embedPopRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(embedPickerOpen, () => setEmbedPickerOpen(false), [embedBtnRef, embedPopRef]);

  const lastSyncRef = useRef(node?.body ?? "");
  useEffect(() => {
    setBody(node?.body ?? "");
    lastSyncRef.current = node?.body ?? "";
  }, [nodeId, node?.body]);

  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") reportStore.close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodeId]);

  const bodyHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(body || "", { async: false, gfm: true, breaks: true }) as string),
    [body],
  );

  if (!nodeId || !node) return null;

  function onBody(v: string) { setBody(v); node!.body = v; scheduleAutosave(); }

  // Commit on blur (edits never propagate per keystroke — see CLAUDE.md). Reconciles
  // the ref INPUT sockets on the small anchor card, drops cables into any vanished
  // ref, re-renders that card, and recomputes so the preview reflects the new refs.
  async function commitBody() {
    if (body === lastSyncRef.current) return;
    lastSyncRef.current = body;
    const { removedInputs } = node!.syncRefs();
    const ed = getEditor();
    if (ed && removedInputs.length) {
      for (const c of ed.getConnections()) {
        if (c.target === node!.id && removedInputs.includes(c.targetInput)) {
          await ed.removeConnection(c.id);
        }
      }
    }
    await getArea()?.update("node", node!.id);
    await processGraph();
  }

  const notes = (editor?.getNodes() ?? []).filter((n): n is NoteNode => n instanceof NoteNode);
  const names = nodeDisplayNames(editor?.getNodes() ?? []);
  const embeddable = notes.filter((n) => !node!.embeds.includes(n.id));

  function addEmbed(id: string) {
    node!.embeds.push(id);
    scheduleAutosave();
    setEmbedPickerOpen(false);
    void getArea()?.update("node", node!.id);
  }
  function removeEmbed(id: string) {
    node!.embeds = node!.embeds.filter((e) => e !== id);
    scheduleAutosave();
    void getArea()?.update("node", node!.id);
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

  return (
    <div className="report-backdrop" onPointerDown={() => reportStore.close()}>
      <div className="report-panel" onPointerDown={(e) => e.stopPropagation()}>
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
                  <button key={n.id} type="button" className="report-embed-opt" onClick={() => addEmbed(n.id)}>
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
              title="Export as a self-contained webpage — refs frozen to today's values, charts and a canvas snapshot inlined"
            >
              {exporting ? "Exporting…" : "Export as webpage"}
            </button>
            <button className="report-close" onClick={() => reportStore.close()} title="Close (Esc)" aria-label="Close">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

        <div className="report-body">
          <textarea
            className="report-source"
            value={body}
            placeholder="Write the report… (markdown, `=name` refs a wired value)"
            spellCheck={false}
            onChange={(e) => onBody(e.target.value)}
            onBlur={() => void commitBody()}
          />
          <div className="report-preview sol-md">
            {body.trim() ? (
              <InlineRefBody nodeId={node.id} bodyHtml={bodyHtml} className="report-preview__md" />
            ) : (
              <div className="report-preview__empty">Preview</div>
            )}
            {node.embeds.length > 0 && (
              <div className="report-embeds">
                {node.embeds.map((id) => (
                  <EmbeddedNote key={id} noteId={id} name={names.get(id) ?? "Note"} onRemove={() => removeEmbed(id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A read-only mini preview of an embedded Note — its rendered markdown, capped
 *  height, with a remove control. Placed-object embedding, not inline text. */
function EmbeddedNote({ noteId, name, onRemove }: { noteId: string; name: string; onRemove: () => void }) {
  const editor = getEditor();
  const note = editor?.getNode(noteId) as NoteNode | undefined;
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(note?.renderBody || "", { async: false, gfm: true, breaks: true }) as string),
    [note?.renderBody],
  );
  if (!note) {
    return (
      <div className="report-embed">
        <div className="report-embed__header">
          <span className="report-embed__name">{name} (removed)</span>
          <button className="report-embed__remove" onClick={onRemove} title="Remove embed" aria-label="Remove embed"><CloseIcon size={12} /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="report-embed">
      <div className="report-embed__header">
        <span className="report-embed__name">{name}</span>
        <button className="report-embed__remove" onClick={onRemove} title="Remove embed" aria-label="Remove embed"><CloseIcon size={12} /></button>
      </div>
      <div className="report-embed__body sol-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
