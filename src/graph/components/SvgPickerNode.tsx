import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SvgPickerNode as SvgPickerNodeType } from "../rete-nodes";
import { scheduleAutosave } from "../persistence";
import { processGraph } from "../process";
import { resolveLayer, elementName } from "../svgLayer";
import type { NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useDraftCommit, INVALID_DRAFT, useEditableLabel } from "./inlineInput";
import { stopDragStart } from "../coarse";
import "./SvgPickerNode.css";

const MIN_H = 80;
const MAX_H = 800;

const hoverGlow = (color: string) => `drop-shadow(0 0 2px ${color}) drop-shadow(0 0 1px ${color})`;
const selectedGlow = (color: string) => `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 2px ${color})`;

// The DISPLAY svg for the idle <img>: the source with the selected layer's glow
// baked in, so the selection still reads while the live SVG isn't mounted.
function bakeSelectionGlow(source: string, sel: string, color: string): string {
  if (!source || !sel) return source;
  try {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    if (doc.querySelector("parsererror")) return source;
    const svg = doc.querySelector("svg");
    if (!svg) return source;
    for (const node of Array.from(svg.querySelectorAll<SVGElement>("*"))) {
      if (elementName(node) === sel) { node.style.filter = selectedGlow(color); break; }
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return source;
  }
}

/** The SVG Picker — outputs the name of whatever layer you click. Highlighting is
 *  IMPERATIVE (React state per pointermove would thrash): hovered and selected
 *  elements are painted with filters directly and restored on change. */
export function SvgPickerComponent({ data, emit }: NodeProps<SvgPickerNodeType>) {
  const [url, setUrl] = useState(data.url);
  const [source, setSource] = useState(data.stringLiterals.source ?? "");
  const [hoverColor, setHoverColor] = useState(data.hoverColor);
  const [selectedLayer, setSelectedLayer] = useState(data.selectedLayer);
  const [height, setHeight] = useState(data.height);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The heavy inline markup (tens of thousands of paths) is mounted ONLY while the
  // pointer is over the well, for hit-testing; the idle view is a rasterized <img>.
  const [hovering, setHovering] = useState(false);
  const [rasterUrl, setRasterUrl] = useState<string | null>(null);
  const rasterUrlRef = useRef<string | null>(null);

  // The shared header title-edit mechanic (click-to-edit, Enter/blur, Escape revert).
  const title = useEditableLabel(data, () => { void processGraph(data.id); });

  // Mirror external changes (undo / paste / load replace the node instance).
  useEffect(() => { setUrl(data.url); }, [data.url]);
  useEffect(() => { setSource(data.stringLiterals.source ?? ""); }, [data.stringLiterals.source]);
  useEffect(() => { setHoverColor(data.hoverColor); }, [data.hoverColor]);
  useEffect(() => { setSelectedLayer(data.selectedLayer); }, [data.selectedLayer]);
  useEffect(() => { setHeight(data.height); }, [data.height]);

  const wellRef = useRef<HTMLDivElement>(null);
  const svgRootRef = useRef<SVGSVGElement | null>(null);
  const hoverElRef = useRef<Element | null>(null);
  const paintedRef = useRef<Element[]>([]);

  // Restore an element's inline filter we previously overrode.
  function restore(el: Element) {
    const s = (el as SVGElement).style;
    if (!s) return;
    const prev = (el as HTMLElement).dataset?.solPrevFilter;
    s.filter = prev ?? "";
    if ((el as HTMLElement).dataset) delete (el as HTMLElement).dataset.solPrevFilter;
  }
  function apply(el: Element, filter: string) {
    const s = (el as SVGElement).style;
    if (!s) return;
    const ds = (el as HTMLElement).dataset;
    if (ds && ds.solPrevFilter === undefined) ds.solPrevFilter = s.filter || "";
    s.filter = filter;
  }
  function clearPainted() {
    for (const el of paintedRef.current) restore(el);
    paintedRef.current = [];
  }
  // Find the element whose resolved layer name matches `name` (for the selection).
  function findNamed(name: string): Element | null {
    const root = svgRootRef.current;
    if (!root) return null;
    for (const node of Array.from(root.querySelectorAll<SVGElement>("*"))) {
      if (elementName(node) === name) return node;
    }
    return null;
  }
  // Repaint from scratch, never double-painting the same element.
  function paint(sel: string, hoverEl: Element | null, color: string) {
    clearPainted();
    const selEl = sel ? findNamed(sel) : null;
    if (selEl) { apply(selEl, selectedGlow(color)); paintedRef.current.push(selEl); }
    if (hoverEl && hoverEl !== selEl) { apply(hoverEl, hoverGlow(color)); paintedRef.current.push(hoverEl); }
  }

  // Mount the live SVG markup ONLY while hovering, then highlight against the
  // fresh DOM; on leave the well div unmounts, so just null the root.
  useLayoutEffect(() => {
    const well = wellRef.current;
    if (!hovering || !well) { svgRootRef.current = null; return; }
    well.innerHTML = source || "";
    const svg = well.querySelector("svg");
    svgRootRef.current = (svg as SVGSVGElement | null) ?? null;
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      (svg as SVGSVGElement).style.width = "100%";
      (svg as SVGSVGElement).style.height = "100%";
      (svg as SVGSVGElement).style.display = "block";
    }
    paintedRef.current = [];
    hoverElRef.current = null;
    paint(selectedLayer, null, hoverColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, hovering]);

  // Rasterize the source to a blob URL, debounced so a color drag doesn't re-parse
  // a big SVG per tick; the previous url is revoked only once the new one exists.
  useEffect(() => {
    if (!source) {
      if (rasterUrlRef.current) { URL.revokeObjectURL(rasterUrlRef.current); rasterUrlRef.current = null; }
      setRasterUrl(null);
      return;
    }
    const t = window.setTimeout(() => {
      const disp = bakeSelectionGlow(source, selectedLayer, hoverColor);
      const u = URL.createObjectURL(new Blob([disp], { type: "image/svg+xml" }));
      if (rasterUrlRef.current) URL.revokeObjectURL(rasterUrlRef.current);
      rasterUrlRef.current = u;
      setRasterUrl(u);
    }, 80);
    return () => window.clearTimeout(t);
  }, [source, selectedLayer, hoverColor]);
  // Revoke the live blob URL on unmount.
  useEffect(() => () => { if (rasterUrlRef.current) URL.revokeObjectURL(rasterUrlRef.current); }, []);

  // Re-apply highlights when the selection or color changes (source untouched).
  useLayoutEffect(() => {
    paint(selectedLayer, hoverElRef.current, hoverColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer, hoverColor]);

  // Resolve a target ONLY if it is actually inside the SVG — otherwise resolveLayer
  // walks UP out of the svg into the node-card DOM and mis-picks.
  function hitLayer(target: EventTarget | null): { el: Element; name: string } | null {
    const root = svgRootRef.current;
    if (!root || !(target instanceof Element) || !root.contains(target)) return null;
    return resolveLayer(target, root);
  }

  // Entering mounts the live SVG so the next move can hit-test; leaving unmounts it.
  function onPointerEnterWell() { setHovering(true); }
  function onPointerMove(e: React.PointerEvent) {
    if (!svgRootRef.current) return;
    const hit = hitLayer(e.target);
    const el = hit?.el ?? null;
    if (el === hoverElRef.current) return; // only repaint when the target changes
    hoverElRef.current = el;
    paint(selectedLayer, el, hoverColor);
  }
  function onPointerLeaveWell() {
    hoverElRef.current = null;
    setHovering(false); // unmount the live SVG; the idle <img> takes over
  }

  // A pick is a discrete action → commit immediately; re-clicking it clears it.
  function onClickWell(e: React.MouseEvent) {
    if (!svgRootRef.current) return;
    const name = hitLayer(e.target)?.name ?? "";
    const next = name === data.selectedLayer ? "" : name;
    setSelectedLayer(next);
    data.selectedLayer = next;
    scheduleAutosave();
    void processGraph(data.id);
  }


  // Committing a URL fetches the SVG text and inlines it; cross-origin hosts may
  // block the fetch (CORS), so the local-file path is the primary route.
  async function loadFromUrl(u: string) {
    if (!u) { setLoadError(null); return; }
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!/<svg[\s>]/i.test(text)) throw new Error("not an SVG");
      setSource(text); data.stringLiterals.source = text;
      setLoadError(null);
      scheduleAutosave();
      void processGraph(data.id);
    } catch {
      setLoadError("Couldn't load an SVG from that URL");
    }
  }
  function onUrl(v: string) { setUrl(v); data.url = v; scheduleAutosave(); }
  function onUrlCommit() { void loadFromUrl(url); }

  // A local .svg is read to TEXT, not a data URL — the picker needs live markup;
  // SVG is text, so it persists directly in stringLiterals, unlike the Image node.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      setSource(text); data.stringLiterals.source = text;
      if (url) { setUrl(""); data.url = ""; }
      setLoadError(null);
      scheduleAutosave();
      void processGraph(data.id);
    };
    reader.readAsText(file);
  }

  // Live swatch while dragging (repaints via state); commit downstream on blur so
  // a wired Report re-reads the new color once, not per drag tick.
  function onColorInput(v: string) { setHoverColor(v); data.hoverColor = v; }
  function onColorCommit() { scheduleAutosave(); void processGraph(data.id); }

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

  return (
    <div
      className={`solenoid-svgpick${data.selected ? " solenoid-svgpick--selected" : ""}`}
      style={{ width: data.width }}
    >
      <div className="solenoid-svgpick__bar">
        {title.editing ? (
          <input className="solenoid-svgpick__name" placeholder="SVG" {...title.inputProps} />
        ) : (
          <div
            className={`solenoid-svgpick__name-display${data.label.trim() ? "" : " solenoid-svgpick__name-display--empty"}`}
            title={data.label || "SVG"}
            {...title.displayProps}
          >
            {data.label.trim() || "SVG"}
          </div>
        )}
        <button
          type="button"
          className="solenoid-svgpick__attach"
          title="Attach a local .svg file"
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
          </svg>
        </button>
        <input ref={fileRef} type="file" accept=".svg,image/svg+xml" hidden onChange={onFile} />
        {data.outputs.chart && (
          <NodeSocket side="output" socketKey="chart" nodeId={data.id} emit={emit} payload={data.outputs.chart.socket} />
        )}
      </div>

      <div className="solenoid-svgpick__content">
        {source ? (
          <div
            className="solenoid-svgpick__well"
            style={{ height }}
            onPointerEnter={onPointerEnterWell}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeaveWell}
            onClick={onClickWell}
            onPointerDown={stopDragStart}
            onMouseDown={stopDragStart}
          >
            {hovering ? (
              <div ref={wellRef} className="solenoid-svgpick__svg" />
            ) : rasterUrl ? (
              <img className="solenoid-svgpick__img" src={rasterUrl} alt="" draggable={false} />
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="solenoid-svgpick__placeholder"
            style={{ height }}
            onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            onPointerDown={stopDragStart}
            onMouseDown={stopDragStart}
          >
            Attach a .svg or paste a URL below
          </button>
        )}

        <div className="solenoid-svgpick__controls" onPointerDown={stopDragStart} onMouseDown={stopDragStart}>
          <input
            className="solenoid-svgpick__url"
            value={url}
            placeholder="https://…svg"
            spellCheck={false}
            onChange={(e) => onUrl(e.target.value)}
            onBlur={onUrlCommit}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
          <label className="solenoid-svgpick__swatch" title="Highlight color">
            <input
              type="color"
              value={hoverColor}
              onChange={(e) => onColorInput(e.target.value)}
              onBlur={onColorCommit}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </label>
          <label className="solenoid-svgpick__height" title="SVG height in px">
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

        {loadError && <div className="solenoid-svgpick__hint">{loadError}</div>}

        <div className="solenoid-svgpick__hero">
          <span className="solenoid-svgpick__hero-label">Layer</span>
          <span className="solenoid-svgpick__hero-value" title={selectedLayer || undefined}>
            {selectedLayer || "—"}
          </span>
          {data.outputs.layer && (
            <NodeSocket side="output" socketKey="layer" nodeId={data.id} emit={emit} payload={data.outputs.layer.socket} />
          )}
        </div>
      </div>
    </div>
  );
}
