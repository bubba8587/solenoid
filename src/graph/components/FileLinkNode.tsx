import { useEffect, useRef, useState } from "react";
import type { FileLinkNode as FileLinkNodeType } from "../rete-nodes";
import { scheduleAutosave } from "../persistence";
import { isDesktop, pickFileLinkDialog, openFilePath, baseNameOf } from "../fileBridge";
import type { NodeProps } from "./nodeKit";
import { stopDragStart } from "../coarse";
import "./FileLinkNode.css";

/** The extension (lowercase, no dot) of a file name, or "" — drives the badge. */
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}
/** A file name with its extension stripped — the auto-filled title. */
function stemOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** A link to a file on disk: title, preview, and an Open button. No sockets — it
 *  carries nothing into the graph. Desktop stores the absolute path and opens the
 *  file in its OS app; on web an attach is session-only (the browser has no path),
 *  so Open works this session and only the name survives a reload. */
export function FileLinkComponent({ data }: NodeProps<FileLinkNodeType>) {
  const [label, setLabel] = useState(data.label);
  const [path, setPath] = useState(data.path);
  const [fileName, setFileName] = useState(data.fileName);
  const [collapsed, setCollapsed] = useState(data.collapsed);
  // Web only: the picked File, so Open can preview it THIS session. Never persisted.
  const [webFile, setWebFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const desktop = isDesktop();

  useEffect(() => { setLabel(data.label); }, [data.label]);
  useEffect(() => { setPath(data.path); }, [data.path]);
  useEffect(() => { setFileName(data.fileName); }, [data.fileName]);
  useEffect(() => { setCollapsed(data.collapsed); }, [data.collapsed]);

  // The title is free text (draft only until Enter/blur is moot — a label isn't
  // wired anywhere, so a live write + autosave is fine, matching the Image node).
  function onLabel(v: string) { setLabel(v); data.label = v; scheduleAutosave(); }

  // Set the link + fill an empty/default title from the file name. Shared by both
  // platforms; `name` is the display name, `p` the absolute path ("" on web).
  function setLink(name: string, p: string) {
    setPath(p); data.path = p;
    setFileName(name); data.fileName = name;
    if (!label.trim() || label === "File Link") { const s = stemOf(name); setLabel(s); data.label = s; }
    scheduleAutosave();
  }

  async function attach() {
    if (desktop) {
      const p = await pickFileLinkDialog();
      if (!p) return;
      setWebFile(null);
      setLink(baseNameOf(p), p);
    } else {
      fileRef.current?.click();
    }
  }

  function onWebFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-attaching the same file
    if (!file) return;
    setWebFile(file);
    setLink(file.name, "");
  }

  function open() {
    if (desktop) { if (path) void openFilePath(path); return; }
    if (webFile) window.open(URL.createObjectURL(webFile), "_blank", "noopener,noreferrer");
  }

  function toggleCollapse() { const v = !collapsed; setCollapsed(v); data.collapsed = v; scheduleAutosave(); }

  const ext = extOf(fileName);
  const hasLink = !!fileName;
  // What Open can act on right now: a desktop path, or a live web pick.
  const canOpen = desktop ? !!path : !!webFile;
  // Web, reloaded onto a session-less link (or a desktop-saved doc opened on web):
  // the name shows but there is nothing to open.
  const webStale = !desktop && hasLink && !webFile;

  return (
    <div
      className={`solenoid-filelink${data.selected ? " solenoid-filelink--selected" : ""}${collapsed ? " solenoid-filelink--collapsed" : ""}`}
    >
      <div className="solenoid-filelink__bar">
        <button
          type="button"
          className="solenoid-filelink__chevron"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={(e) => { e.stopPropagation(); toggleCollapse(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          className="solenoid-filelink__name"
          value={label}
          placeholder="File Link"
          spellCheck={false}
          onChange={(e) => onLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        />
        <button
          type="button"
          className="solenoid-filelink__attach"
          title={hasLink ? "Link a different file" : "Link a file"}
          onClick={(e) => { e.stopPropagation(); void attach(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
          </svg>
        </button>
        <input ref={fileRef} type="file" hidden onChange={onWebFile} />
      </div>

      {!collapsed && (
        <div className="solenoid-filelink__content">
          {hasLink ? (
            <>
              <div className="solenoid-filelink__preview" title={path || fileName}>
                <span className="solenoid-filelink__glyph" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                  {ext && <span className="solenoid-filelink__ext">{ext}</span>}
                </span>
                <span className="solenoid-filelink__file">{fileName}</span>
              </div>
              <button
                type="button"
                className="solenoid-filelink__open"
                disabled={!canOpen}
                title={webStale ? "Re-link the file to open it in this browser" : "Open the file"}
                onClick={(e) => { e.stopPropagation(); open(); }}
                onPointerDown={stopDragStart}
                onMouseDown={stopDragStart}
              >
                Open
              </button>
              {webStale && (
                <div className="solenoid-filelink__hint">Local link, not saved with the document</div>
              )}
            </>
          ) : (
            <button
              type="button"
              className="solenoid-filelink__placeholder"
              onClick={(e) => { e.stopPropagation(); void attach(); }}
              onPointerDown={stopDragStart}
              onMouseDown={stopDragStart}
            >
              Link a file on your computer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
