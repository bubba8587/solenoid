import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SvgPickerNode as SvgPickerNodeType } from "../rete-nodes";
import { scheduleAutosave } from "../persistence";
import { processGraph } from "../process";
import { resolveLayer, elementName } from "../svgLayer";
import type { NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { stopDragStart } from "../coarse";
import "./SvgPickerNode.css";

const MIN_H = 80;
const MAX_H = 800;

const hoverGlow = (color: string) => `drop-shadow(0 0 2px ${color}) drop-shadow(0 0 1px ${color})`;
const selectedGlow = (color: string) => `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 2px ${color})`;

/**
 * The SVG Picker — an interactive picture that outputs the name of whatever layer
 * you click, so it doubles as a visual data slicer (click a region on a map →
 * filter a dataset by it). Load an SVG (local `.svg` or a web URL, like Image); the
 * markup is inlined into the well so its inner shapes are hoverable + clickable.
 * Hover glows a selectable element in the chosen colour; click commits it as the
 * `Layer` output (Enter/blur commits on the text fields; a pick is a discrete
 * action, committed immediately). Clicking the current pick again clears it.
 *
 * Highlighting is done imperatively (a pointermove that set React state per move
 * would thrash): we track the hovered + selected elements and paint filters onto
 * them directly, restoring on change. The header bar is the drag handle; the well
 * stops pointerdown so a click-to-pick never starts a node drag.
 */
export function SvgPickerComponent({ data, emit }: NodeProps<SvgPickerNodeType>) {
  const [label, setLabel] = useState(data.label);
  const [url, setUrl] = useState(data.url);
  const [source, setSource] = useState(data.stringLiterals.source ?? "");
  const [hoverColor, setHoverColor] = useState(data.hoverColor);
  const [selectedLayer, setSelectedLayer] = useState(data.selectedLayer);
  const [height, setHeight] = useState(data.height);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Mirror external changes (undo / paste / load replace the node instance).
  useEffect(() => { setLabel(data.label); }, [data.label]);
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
  // Repaint everything from scratch: the selected layer (steady glow) + the hovered
  // element (lighter glow), never double-painting the same element.
  function paint(sel: string, hoverEl: Element | null, color: string) {
    clearPainted();
    const selEl = sel ? findNamed(sel) : null;
    if (selEl) { apply(selEl, selectedGlow(color)); paintedRef.current.push(selEl); }
    if (hoverEl && hoverEl !== selEl) { apply(hoverEl, hoverGlow(color)); paintedRef.current.push(hoverEl); }
  }

  // (Re)inject the SVG markup whenever the source changes; rescale + re-apply the
  // selection highlight against the fresh DOM.
  useLayoutEffect(() => {
    const well = wellRef.current;
    if (!well) return;
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
  }, [source]);

  // Re-apply highlights when the selection or colour changes (source untouched).
  useLayoutEffect(() => {
    paint(selectedLayer, hoverElRef.current, hoverColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer, hoverColor]);

  // Resolve a pointer target to a layer, but ONLY if it's actually inside the SVG
  // — clicking the well's padding lands on the container div, and without this
  // guard resolveLayer would walk UP out of the svg into the node card DOM (whose
  // rete elements have ids) and mis-pick. Outside the svg → no hit.
  function hitLayer(target: EventTarget | null): { el: Element; name: string } | null {
    const root = svgRootRef.current;
    if (!root || !(target instanceof Element) || !root.contains(target)) return null;
    return resolveLayer(target, root);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!svgRootRef.current) return;
    const hit = hitLayer(e.target);
    const el = hit?.el ?? null;
    if (el === hoverElRef.current) return; // only repaint when the target changes
    hoverElRef.current = el;
    paint(selectedLayer, el, hoverColor);
  }
  function onPointerLeaveWell() {
    if (!hoverElRef.current) return;
    hoverElRef.current = null;
    paint(selectedLayer, null, hoverColor);
  }

  // A pick is a discrete action → commit immediately (like a dropdown). Clicking
  // the current selection (or empty space) clears it.
  function onClickWell(e: React.MouseEvent) {
    if (!svgRootRef.current) return;
    const name = hitLayer(e.target)?.name ?? "";
    const next = name === data.selectedLayer ? "" : name;
    setSelectedLayer(next);
    data.selectedLayer = next;
    scheduleAutosave();
    void processGraph(data.id);
  }

  function onLabel(v: string) { setLabel(v); data.label = v; scheduleAutosave(); }
  function commitValue() { void processGraph(data.id); }

  // Typing a URL and committing (Enter/blur) fetches the SVG text and inlines it.
  // Cross-origin hosts may block the fetch (CORS) — the local-file path always
  // works and is the primary route; a failed fetch just leaves a small hint.
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

  // Attaching a local .svg reads it to TEXT (not a data URL — the picker needs the
  // live markup) and takes over as the source, dropping any URL. SVG is text, so it
  // persists directly in stringLiterals (no bundling, unlike the Image node).
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
  // a wired Report re-reads the new colour once, not per drag tick.
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
      <div className="solenoid-svgpick__bar" title="Drag to move">
        <input
          className="solenoid-svgpick__name"
          value={label}
          placeholder="SVG"
          spellCheck={false}
          onChange={(e) => onLabel(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        />
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
        {/* Chart-family output — wire the picture into a Report. */}
        {data.outputs.chart && (
          <NodeSocket side="output" socketKey="chart" nodeId={data.id} emit={emit} payload={data.outputs.chart.socket} />
        )}
      </div>

      <div className="solenoid-svgpick__content">
        {source ? (
          <div
            ref={wellRef}
            className="solenoid-svgpick__well"
            style={{ height }}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeaveWell}
            onClick={onClickWell}
            onPointerDown={stopDragStart}
            onMouseDown={stopDragStart}
          />
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
          <label className="solenoid-svgpick__swatch" title="Highlight colour">
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

        {/* Hero: the picked layer name + the string output socket. */}
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
