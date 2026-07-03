import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { reportStore } from "../reportStore";
import { getEditor, getArea, processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { NoteNode, ReportNode } from "../rete-nodes";
import { nodeDisplayNames } from "../nodeNames";
import { InlineRefBody } from "./inlineRefDisplay";
import { preprocessEmbeds, extractEmbedNames } from "../reportEmbeds";
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

  // Reset the editor's local draft ONLY when a different report opens (keyed on
  // nodeId, NOT node.body). onBody writes node.body live for autosave, so
  // depending on node.body here would re-run this mid-typing and clobber
  // lastSyncRef — which made commitBody's "did it change since last sync?" guard
  // always short-circuit, so the ref sockets were NEVER minted. (The whole
  // reason Report sockets appeared broken.)
  const lastSyncRef = useRef(node?.body ?? "");
  useEffect(() => {
    setBody(node?.body ?? "");
    lastSyncRef.current = node?.body ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") reportStore.close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodeId]);

  const bodyHtml = useMemo(
    // preprocessEmbeds turns each `![[Name]]` token into a data-embed marker
    // BEFORE markdown parse, so an embedded Note renders where the author put
    // it (DOMPurify keeps class + data-* on the bare span). ADD_ATTR is belt-
    // and-suspenders — data-* survive by default, but be explicit.
    () => DOMPurify.sanitize(
      marked.parse(preprocessEmbeds(body || ""), { async: false, gfm: true, breaks: true }) as string,
      { ADD_ATTR: ["data-embed"] },
    ),
    [body],
  );

  const sourceRef = useRef<HTMLTextAreaElement>(null);

  if (!nodeId || !node) return null;

  function onBody(v: string) { setBody(v); node!.body = v; scheduleAutosave(); }

  // Commit on blur (edits never propagate per keystroke — see CLAUDE.md). Reconciles
  // the ref INPUT sockets on the small anchor card, drops cables into any vanished
  // ref, re-renders that card, and recomputes so the preview reflects the new refs.
  async function commitBody() {
    if (body === lastSyncRef.current) return;
    lastSyncRef.current = body;
    // Keep node.embeds in step with the `![[Name]]` tokens actually in the body
    // (the export reads embeds), resolving each name to a live Note id.
    const embedNames = extractEmbedNames(body);
    const ed0 = getEditor();
    const allNotes = (ed0?.getNodes() ?? []).filter((n): n is NoteNode => n instanceof NoteNode);
    const nm = nodeDisplayNames(ed0?.getNodes() ?? []);
    node!.embeds = embedNames
      .map((name) => allNotes.find((n) => (nm.get(n.id) ?? n.label ?? "").trim().toLowerCase() === name.toLowerCase())?.id)
      .filter((id): id is string => !!id);
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
  // Every Note is insertable — a note can be placed more than once, and
  // placement is a token, not a membership toggle.
  const embeddable = notes;
  // Resolve an `![[Name]]` token to a Note by display name (case-insensitive).
  function noteByName(name: string): NoteNode | undefined {
    const target = name.trim().toLowerCase();
    return notes.find((n) => (names.get(n.id) ?? n.label ?? "").trim().toLowerCase() === target);
  }

  // Embedding now INSERTS an `![[Name]]` token at the cursor — placement lives
  // in the markdown, the author controls it. `embeds` still tracks which notes
  // are referenced (kept in sync from the tokens on commit) for the export.
  function addEmbed(id: string) {
    const note = editor?.getNode(id) as NoteNode | undefined;
    const label = names.get(id) ?? note?.label ?? "Note";
    const ta = sourceRef.current;
    const token = `![[${label}]]`;
    if (ta) {
      const start = ta.selectionStart ?? body.length;
      const end = ta.selectionEnd ?? body.length;
      // Own paragraph if we're mid-line, so the block sits clean.
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
    if (!node!.embeds.includes(id)) node!.embeds.push(id);
    scheduleAutosave();
    setEmbedPickerOpen(false);
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
            ref={sourceRef}
            className="report-source"
            value={body}
            placeholder="Write the report… (markdown · `=name` shows a wired value · ![[Note]] embeds a note)"
            spellCheck={false}
            onChange={(e) => onBody(e.target.value)}
            onBlur={() => void commitBody()}
          />
          <div className="report-preview sol-md">
            {body.trim() ? (
              <InlineRefBody
                nodeId={node.id}
                bodyHtml={bodyHtml}
                className="report-preview__md"
                renderEmbed={(name) => {
                  const note = noteByName(name);
                  return note
                    ? <EmbeddedNote noteId={note.id} name={names.get(note.id) ?? name} />
                    : <span className="report-embed-missing">![[{name}]] — no note by that name</span>;
                }}
              />
            ) : (
              <div className="report-preview__empty">Preview</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A read-only mini preview of an embedded Note — its rendered markdown, placed
 *  inline where its `![[Name]]` token sits. Removal is deleting the token (no
 *  separate control — the markdown is the source of truth for placement). */
function EmbeddedNote({ noteId, name }: { noteId: string; name: string }) {
  const editor = getEditor();
  const note = editor?.getNode(noteId) as NoteNode | undefined;
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(note?.renderBody || "", { async: false, gfm: true, breaks: true }) as string),
    [note?.renderBody],
  );
  if (!note) {
    return (
      <div className="report-embed">
        <div className="report-embed__header"><span className="report-embed__name">{name} (removed)</span></div>
      </div>
    );
  }
  return (
    <div className="report-embed">
      <div className="report-embed__header"><span className="report-embed__name">{name}</span></div>
      <div className="report-embed__body sol-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
