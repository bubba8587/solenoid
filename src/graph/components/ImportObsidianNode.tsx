import { useFlowResizeGrip } from "../flowSurface";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ImportObsidianNode as ImportObsidianNodeType } from "../rete-nodes";
import { hexToRgba, themeAccent, resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";
import { settingsStore } from "../settingsStore";
import { SwatchGrid } from "./SwatchGrid";
import { NodeSocket } from "./NodeSocket";
import { FieldRow } from "./NoteNode";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { useEditableLabel } from "./inlineInput";
import { isDesktop, listVaultMarkdownFiles, readVaultFile } from "../fileBridge";
import { getActiveView, getActiveEditor } from "../activeGraph";
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { reconcileFcTypes } from "../fcReconcile";
import { dropStrandedFrontmatterCables } from "../noteFrontmatterSync";
import { scheduleAutosave } from "../persistence";
import { stopDragStart } from "../coarse";
import type { NodeProps } from "./nodeKit";
import type { FrontmatterFieldType } from "../noteFrontmatter";
import "./NoteNode.css";
import "./ImportObsidianNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

const MIN_W = 200;
const MIN_H = 96;
const FIELD_ROW_H = 22;
const fieldsStripHeight = (n: number) => (n > 0 ? n * FIELD_ROW_H + 6 : 0);

/** The base name (no folders, no `.md`) — the default title when a file is picked. */
function baseName(rel: string): string {
  return (rel.split("/").pop() ?? rel).replace(/\.md$/i, "");
}

/** Desktop only for the file READ; a loaded save still shows the persisted body
 *  anywhere. */
export function ImportObsidianComponent({ data, emit }: NodeProps<ImportObsidianNodeType>) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [color, setColor] = useState(data.color);
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const [body, setBody] = useState(data.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [, setFieldsVersion] = useState(0);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(colorOpen, () => setColorOpen(false), [swatchRef, paletteRef]);

  const desktop = isDesktop();
  const vault = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("obsidianVault"));

  // The shared header title-edit mechanic (click-to-edit, Enter/blur, Escape revert).
  const title = useEditableLabel(data, () => { void getActiveView()?.rerenderNode(data.id); });
  useEffect(() => { setColor(data.color); }, [data.color]);
  useEffect(() => { setCollapsed(data.collapsed); }, [data.collapsed]);
  useEffect(() => { setBody(data.body); }, [data.body]);

  useEffect(() => {
    if (!pickerOpen) return;
    let live = true;
    void listVaultMarkdownFiles(vault).then((f) => { if (live) setFiles(f); });
    return () => { live = false; };
  }, [pickerOpen, vault]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
  }, [files, search]);

  // The same reconcile the Note's on-blur commit runs: re-derive the frontmatter
  // sockets, then drop the cables a removed/retyped key stranded.
  async function applyBody(content: string, sourcePath: string) {
    data.body = content;
    data.fileName = sourcePath;
    if (sourcePath && (data.label === "Import Obsidian Note" || data.label.trim() === "")) {
      data.label = baseName(sourcePath); // title hook resyncs its display off data.label
    }
    const { removed, retyped } = data.syncFields();
    await dropStrandedFrontmatterCables(data.id, removed, retyped);
    setBody(content);
    setFieldsVersion((v) => v + 1);
    const editor = getActiveEditor();
    const view = getActiveView();
    await view?.rerenderNode(data.id);
    if (editor && view && retyped.length) reconcileFcTypes(editor, view);
    bumpConnectionVersion();
    await processGraph();
    scheduleAutosave();
  }

  async function pickFile(rel: string) {
    try {
      const content = await readVaultFile(vault, rel);
      await applyBody(content, rel);
      setPickerOpen(false);
    } catch { /* unreadable (moved/renamed) — leave the current body */ }
  }

  async function reload() {
    if (!data.fileName) return;
    try { await applyBody(await readVaultFile(vault, data.fileName), data.fileName); }
    catch { /* file gone — keep what's loaded */ }
  }

  function pick(c: string) { setColor(c); data.color = c; void getActiveView()?.rerenderNode(data.id); scheduleAutosave(); }
  function toggleCollapse() { const v = !collapsed; setCollapsed(v); data.collapsed = v; scheduleAutosave(); }

  const fieldKeys = data.fieldKeys();
  const fieldValues = data.fieldValues();
  const minH = MIN_H + fieldsStripHeight(fieldKeys.length);

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [docDotTop, setDocDotTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const bodyEl = bodyRef.current, rootEl = rootRef.current;
    if (!bodyEl || !rootEl) { setDocDotTop(undefined); return; }
    let y = 0;
    for (let el: HTMLElement | null = bodyEl; el && el !== rootEl; el = el.offsetParent as HTMLElement | null) y += el.offsetTop;
    setDocDotTop(y + bodyEl.offsetHeight / 2 - 6);
  }, [collapsed, fieldKeys.length, pickerOpen, data.height, data.width, body]);

  const bodyHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(data.renderBody || "", { async: false, gfm: true, breaks: true }) as string),
    [body], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const mode = appThemeStore.getMode();
  const themed = themeAccent(resolveColor(color), mode);
  const vars = { "--note-color": themed, "--note-bg": hexToRgba(themed, 0.3) } as React.CSSProperties;

  const Grip = useFlowResizeGrip();
  function onResize(size: { width: number; height: number }) {
    data.width = Math.max(MIN_W, size.width);
    data.height = Math.max(minH, size.height);
    void getActiveView()?.rerenderNode(data.id);
  }

  return (
    <div
      ref={rootRef}
      className={`solenoid-note${data.selected ? " solenoid-note--selected" : ""}${collapsed ? " solenoid-note--collapsed" : ""}${fieldKeys.length ? " solenoid-note--has-fields" : ""}`}
      style={{ width: data.width, height: collapsed ? undefined : Math.max(data.height, minH), ...vars }}
    >
      <div className="solenoid-note__bar">
        <button
          type="button"
          className="solenoid-note__chevron"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={(e) => { e.stopPropagation(); toggleCollapse(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {title.editing ? (
          <input className="solenoid-note__name" placeholder="Import Obsidian Note" {...title.inputProps} />
        ) : (
          <div
            className={`solenoid-note__name-display${data.label.trim() ? "" : " solenoid-note__name-display--empty"}`}
            title={data.label || "Import Obsidian Note"}
            {...title.displayProps}
          >
            {data.label.trim() || "Import Obsidian Note"}
          </div>
        )}
        <button
          type="button"
          className="solenoid-note__swatch"
          title={pickerOpen ? "Hide files" : "Choose a vault file"}
          onClick={(e) => { e.stopPropagation(); setPickerOpen((o) => !o); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          {/* Lucide "folder-open" (ISC). */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
        <button
          ref={swatchRef}
          type="button"
          className="solenoid-note__swatch"
          title="Note color"
          onClick={(e) => { e.stopPropagation(); setPickerOpen(false); /* color popup */ setColorOpen((o) => !o); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6" cy="6" r="4.5" />
          </svg>
        </button>
        {colorOpen && (
          <div ref={paletteRef} className="solenoid-note__palette" onPointerDown={stop} onMouseDown={stop}>
            <SwatchGrid value={color} onPick={pick} />
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="sol-import__picker" onPointerDown={stop} onMouseDown={stop}>
          {!desktop ? (
            <div className="sol-import__empty">Reading a vault is available in the desktop app only.</div>
          ) : vault.trim() === "" ? (
            <div className="sol-import__empty">Set the Obsidian vault folder in Settings.</div>
          ) : (
            <>
              <input
                className="sol-import__search"
                type="text"
                value={search}
                placeholder="Search notes…"
                spellCheck={false}
                autoFocus
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="sol-import__list nowheel">
                {filtered.length === 0 ? (
                  <div className="sol-import__empty">No .md files</div>
                ) : (
                  filtered.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`sol-import__row${f === data.fileName ? " sol-import__row--on" : ""}`}
                      title={f}
                      onClick={() => void pickFile(f)}
                    >
                      {f}
                    </button>
                  ))
                )}
              </div>
              <div className="sol-import__foot">
                <span className="sol-import__file" title={data.fileName || undefined}>{data.fileName || "no file"}</span>
                <button type="button" className="sol-import__reload" title="Reload from the vault" onClick={() => void reload()} disabled={!data.fileName}>Reload</button>
              </div>
            </>
          )}
        </div>
      )}

      {fieldKeys.length > 0 && (
        <div className="solenoid-note__fields">
          {fieldKeys.map((key) => {
            const t = data.fieldType(key);
            const output = data.outputs[key];
            if (!t || !output) return null;
            return (
              <FieldRow
                key={key}
                nodeId={data.id}
                emit={emit}
                fieldKey={key}
                type={t}
                value={fieldValues[key]}
                socket={output.socket}
                onPickType={(nt: FrontmatterFieldType) => { data.fieldTypes[key] = nt; void applyBody(data.body, data.fileName); }}
              />
            );
          })}
        </div>
      )}

      {data.outputs.document && (
        <NodeSocket side="output" socketKey="document" nodeId={data.id} emit={emit} payload={data.outputs.document.socket} top={docDotTop} />
      )}

      {!collapsed && (
        <div ref={bodyRef} className="solenoid-note__content">
          {data.renderBody.trim() ? (
            <div
              className="solenoid-note__rendered sol-md nowheel"
              onPointerDown={stopDragStart}
              onMouseDown={stopDragStart}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : (
            <div
              className="solenoid-note__rendered solenoid-note__rendered--empty"
              onPointerDown={stopDragStart}
              onMouseDown={stopDragStart}
            >
              {data.fileName ? "Empty note" : "Choose a vault file"}
            </div>
          )}
        </div>
      )}

      {!collapsed && Grip && (
        <Grip className="solenoid-note__resize" minWidth={MIN_W} minHeight={minH} onResize={onResize} onResizeEnd={() => scheduleAutosave()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M11 5 5 11M11 9l-2 2" />
          </svg>
        </Grip>
      )}
    </div>
  );
}
