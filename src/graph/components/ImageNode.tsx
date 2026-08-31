import { useEffect, useRef, useState } from "react";
import type { ImageNode as ImageNodeType } from "../rete-nodes";
import { scheduleAutosave } from "../persistence";
import { processGraph } from "../process";
import { hydrateImageAsset } from "../imageAssets";
import type { NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useDraftCommit, INVALID_DRAFT, useEditableLabel } from "./inlineInput";
import { stopDragStart } from "../coarse";
import "./ImageNode.css";

const MIN_H = 60;
const MAX_H = 800;

/** The header bar is the drag handle, so its inputs/buttons must stop pointerdown.
 *  Label/URL/height/attachment all ride the emitted ImageValue, so each commit
 *  recomputes the downstream cone. */
export function ImageComponent({ data, emit }: NodeProps<ImageNodeType>) {
  const [url, setUrl] = useState(data.url);
  const [dataUrl, setDataUrl] = useState(data.dataUrl);
  const [height, setHeight] = useState(data.height);
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const fileRef = useRef<HTMLInputElement>(null);
  // The shared title-edit mechanic; the label becomes ImageValue.title, so a commit
  // recomputes the downstream cone.
  const title = useEditableLabel(data, () => { void processGraph(data.id); });

  useEffect(() => { setUrl(data.url); }, [data.url]);
  // Asset hydration sets data.dataUrl AFTER mount — sync it in.
  useEffect(() => { setDataUrl(data.dataUrl); }, [data.dataUrl]);
  useEffect(() => { void hydrateImageAsset(data); }, [data]);
  useEffect(() => { setHeight(data.height); }, [data.height]);
  useEffect(() => { setCollapsed(data.collapsed); }, [data.collapsed]);

  const src = dataUrl || url;

  function commitValue() { void processGraph(data.id); }

  // A URL takes over as the source and drops any local attachment, bundled-file
  // binding included — the asset stays on disk, the node just stops pointing at it.
  function onUrl(v: string) {
    setUrl(v); data.url = v;
    if (dataUrl) { setDataUrl(""); data.dataUrl = ""; }
    if (data.assetPath) { data.assetPath = ""; data.fileName = ""; }
    scheduleAutosave();
  }

  // An empty/invalid entry reverts to the current height instead of snapping to MIN_H.
  const heightField = useDraftCommit<number>(
    height,
    (v) => String(v),
    (text) => {
      const n = parseFloat(text);
      if (!Number.isFinite(n)) return INVALID_DRAFT;
      return Math.max(MIN_H, Math.min(MAX_H, Math.round(n)));
    },
    (h) => { setHeight(h); data.height = h; scheduleAutosave(); void processGraph(data.id); },
  );

  // The data URL is session-only and never written into the save JSON; assetPath
  // resets so the new attachment gets its own bundle slot.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-attaching the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const d = String(reader.result);
      setDataUrl(d); data.dataUrl = d;
      data.fileName = file.name;
      data.assetPath = "";
      if (url) { setUrl(""); data.url = ""; }
      scheduleAutosave();
      void processGraph(data.id);
    };
    reader.readAsDataURL(file);
  }

  function toggleCollapse() { const v = !collapsed; setCollapsed(v); data.collapsed = v; scheduleAutosave(); }

  return (
    <div
      className={`solenoid-image${data.selected ? " solenoid-image--selected" : ""}${collapsed ? " solenoid-image--collapsed" : ""}`}
      style={{ width: data.width }}
    >
      <div className="solenoid-image__bar">
        <button
          type="button"
          className="solenoid-image__chevron"
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
          <input className="solenoid-image__name" placeholder="Image" {...title.inputProps} />
        ) : (
          <div
            className={`solenoid-image__name-display${data.label.trim() ? "" : " solenoid-image__name-display--empty"}`}
            title={data.label || "Image"}
            {...title.displayProps}
          >
            {data.label.trim() || "Image"}
          </div>
        )}
        <button
          type="button"
          className="solenoid-image__attach"
          title="Attach a local image file"
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
          </svg>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        {/* The bar is a positioning context and isn't overflow-clipped, so the dot
            straddles the card edge and stays reachable when collapsed. */}
        {data.outputs.image && (
          <NodeSocket side="output" socketKey="image" nodeId={data.id} emit={emit} payload={data.outputs.image.socket} />
        )}
      </div>

      {!collapsed && (
        <div className="solenoid-image__content">
          {src ? (
            <img className="solenoid-image__img" src={src} alt={data.label || "image"} style={{ height }} draggable={false} />
          ) : (
            <button
              type="button"
              className="solenoid-image__placeholder"
              style={{ height }}
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
              onPointerDown={stopDragStart}
              onMouseDown={stopDragStart}
            >
              Attach an image or paste a URL below
            </button>
          )}

          <div className="solenoid-image__controls" onPointerDown={stopDragStart} onMouseDown={stopDragStart}>
            <input
              className="solenoid-image__url"
              value={url}
              placeholder="https://image-url…"
              spellCheck={false}
              onChange={(e) => onUrl(e.target.value)}
              onBlur={commitValue}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
            <label className="solenoid-image__height" title="Image height in px">
              H
              <input
                type="number"
                min={MIN_H}
                max={MAX_H}
                value={heightField.draft}
                onChange={(e) => heightField.setDraft(e.target.value)}
                onBlur={heightField.onBlur}
                onKeyDown={heightField.onKeyDown}
              />
            </label>
          </div>

          {dataUrl && !data.assetPath && (
            <div className="solenoid-image__hint">Local file; not saved with the document</div>
          )}
        </div>
      )}
    </div>
  );
}
