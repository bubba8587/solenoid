import { useEffect, useRef, useState } from "react";
import type { ImageNode as ImageNodeType } from "../rete-nodes";
import { scheduleAutosave } from "../persistence";
import { processGraph } from "../process";
import { hydrateImageAsset } from "../imageAssets";
import type { NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { stopDragStart } from "../coarse";
import "./ImageNode.css";

const MIN_H = 60;
const MAX_H = 800;

/**
 * A canvas Image — a free-floating picture annotation. The header bar is the drag
 * handle (inputs/buttons stop pointerdown so editing doesn't start a node drag).
 * The source is a web URL (persisted) or a locally-attached file (read to a data
 * URL, session-only — see ImageNode). The height field sizes the image well; the
 * image is letterboxed (object-fit: contain) so any aspect ratio looks tidy. The
 * node emits an ImageValue (src/height/title) on its `chart`-family output, so a
 * value-affecting edit (label/URL/height/attachment) recomputes the downstream
 * cone on commit; edits also persist via scheduleAutosave.
 */
export function ImageComponent({ data, emit }: NodeProps<ImageNodeType>) {
  const [label, setLabel] = useState(data.label);
  const [url, setUrl] = useState(data.url);
  const [dataUrl, setDataUrl] = useState(data.dataUrl);
  const [height, setHeight] = useState(data.height);
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLabel(data.label); }, [data.label]);
  useEffect(() => { setUrl(data.url); }, [data.url]);
  // Asset hydration (imageAssets.ts) sets data.dataUrl AFTER mount — sync it in.
  useEffect(() => { setDataUrl(data.dataUrl); }, [data.dataUrl]);
  // Desktop: a bundled image (assetPath, no session dataUrl yet) loads itself
  // from the doc's images/ folder on mount — covers doc load, paste, restore.
  useEffect(() => { void hydrateImageAsset(data); }, [data]);
  useEffect(() => { setHeight(data.height); }, [data.height]);
  useEffect(() => { setCollapsed(data.collapsed); }, [data.collapsed]);

  const src = dataUrl || url;

  // Unlike an ordinary node, the Image bakes its label into the emitted value
  // (ImageValue.title / alt), so the header label IS data. Keep the input live per
  // keystroke, but the downstream propagation — a wired Report re-reading the new
  // title — commits on blur/Enter (never per keystroke; see the commit-on-Enter
  // principle + "never processGraph from onChange"). processGraph(id) resets this
  // node + its downstream cone so data() re-runs with the new label.
  function onLabel(v: string) { setLabel(v); data.label = v; scheduleAutosave(); }
  // Recompute this node + its downstream cone so consumers re-read the new value
  // (title/alt/src). Shared by the label + URL commit paths.
  function commitValue() { void processGraph(data.id); }

  // Typing a URL takes over as the source and drops any local attachment (its
  // bundled-file binding included — the asset stays on disk, the node just no
  // longer points at it). The src rides the value too, so it commits on blur.
  function onUrl(v: string) {
    setUrl(v); data.url = v;
    if (dataUrl) { setDataUrl(""); data.dataUrl = ""; }
    if (data.assetPath) { data.assetPath = ""; data.fileName = ""; }
    scheduleAutosave();
  }

  // Height commits on Enter/blur (not per keystroke), so you can clear the field
  // and type a new value; an empty/invalid entry reverts to the current height
  // instead of snapping to the min. (useDraftCommit is the project-wide pattern.)
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

  // Attaching a local file reads it to a data URL (session) and takes over as the
  // source, dropping any URL. The data URL is never written into the save JSON;
  // on desktop the next save-to-disk bundles it as a plain file under images/
  // beside the doc (imageAssets.ts) — fileName names that copy, and assetPath
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
      void processGraph(data.id); // the new src rides the value → refresh consumers
    };
    reader.readAsDataURL(file);
  }

  function toggleCollapse() { const v = !collapsed; setCollapsed(v); data.collapsed = v; scheduleAutosave(); }

  return (
    <div
      className={`solenoid-image${data.selected ? " solenoid-image--selected" : ""}${collapsed ? " solenoid-image--collapsed" : ""}`}
      style={{ width: data.width }}
    >
      <div className="solenoid-image__bar" title="Drag to move">
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
        <input
          className="solenoid-image__name"
          value={label}
          placeholder="Image"
          spellCheck={false}
          onChange={(e) => onLabel(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        />
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
        {/* Chart-family output — wire the image into a Report. The bar is a
            positioning context and isn't overflow-clipped, so the dot straddles the
            card's right edge and stays reachable even when collapsed. */}
        {data.outputs.image && (
          <NodeSocket side="output" socketKey="image" nodeId={data.id} emit={emit} payload={data.outputs.image.socket} />
        )}
      </div>

      {!collapsed && (
        <div className="solenoid-image__content">
          {src ? (
            <img className="solenoid-image__img" src={src} alt={label || "image"} style={{ height }} draggable={false} />
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
