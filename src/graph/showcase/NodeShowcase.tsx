import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NodeEditor } from "rete";
import { AreaPlugin } from "rete-area-plugin";
import { ReactPlugin } from "rete-react-plugin";
import { DataflowEngine } from "rete-engine";
import type { Schemes, AreaExtra, SolenoidNode } from "../schemes";
import { solenoidClassicRenderSetup } from "../areaPresets";
import { FLAT_CATALOG } from "../catalogUtils";
import { setEditorRefs, processGraph } from "../process";
import { installErrorGuards } from "../errorValue";
import { nodeNameStore } from "../nodeNameStore";
import { FormulaPopup } from "../components/FormulaPopup";
import { TablePopup } from "../components/TablePopup";
import { CubePopup } from "../components/CubePopup";
import { ChartPopup } from "../components/ChartPopup";
import { ElementPicker } from "../components/ElementPicker";
import { PivotEditorPopup } from "../components/PivotEditorPopup";
import "./NodeShowcase.css";

// The ?showcase UI-audit harness: ONE real node on a static stage, driven by URL,
// arrow keys or window.__showcase. Pan/zoom off, so screenshots are stable.

const PAD = 48; // canvas-units from the stage origin to the node's top-left

type Mount = {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
};

export default function NodeShowcase({ initialType }: { initialType: string }) {
  const entries = useMemo(
    () => [...FLAT_CATALOG.values()].filter((e) => !e.hidden),
    [],
  );
  const [query, setQuery] = useState("");
  const [type, setType] = useState(() =>
    entries.some((e) => e.type === initialType) ? initialType : entries[0]?.type ?? "",
  );
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<Mount | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.label.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
    );
  }, [entries, query]);
  const idx = visible.findIndex((e) => e.type === type);

  function step(d: number) {
    if (!visible.length) return;
    const i = idx < 0 ? (d > 0 ? 0 : visible.length - 1) : (idx + d + visible.length) % visible.length;
    setType(visible[i].type);
  }

  // Same render preset as the canvas, so the card here is byte-for-byte the real one.
  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;
    const editor = new NodeEditor<Schemes>();
    const area = new AreaPlugin<Schemes, AreaExtra>(container);
    const reactPlugin = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
    const engine = new DataflowEngine<Schemes>();
    reactPlugin.addPreset(solenoidClassicRenderSetup());
    editor.addPipe((ctx) => {
      if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
      return ctx;
    });
    editor.use(area);
    area.use(reactPlugin);
    editor.use(engine);
    // Static stage: no background pan, no wheel zoom (zoom is the preset buttons).
    area.area.setDragHandler(null);
    area.area.setZoomHandler(null);
    // Point the module singletons at THIS stack; safe only because Canvas never mounts
    // in showcase mode, so no persistence hook can reach the user's documents.
    setEditorRefs(editor, engine, area);
    mountRef.current = { editor, area };
    setReady(true);
    return () => {
      mountRef.current = null;
      area.destroy();
    };
  }, []);

  useEffect(() => {
    const m = mountRef.current;
    if (!m || !ready || !type) return;
    let canceled = false;
    void (async () => {
      await m.editor.clear();
      const entry = FLAT_CATALOG.get(type);
      if (!entry || canceled) return;
      const node = entry.create() as unknown as SolenoidNode;
      await m.editor.addNode(node);
      if (canceled) return;
      nodeNameStore.ensure(node.id, node.constructor.name);
      await m.area.translate(node.id, { x: PAD, y: PAD });
      await processGraph();
    })();
    return () => { canceled = true; };
  }, [type, ready]);

  useEffect(() => {
    const m = mountRef.current;
    if (m && ready) void m.area.area.zoom(zoom, 0, 0);
  }, [zoom, ready]);

  // Deep-link stays current so a reload lands on the same node.
  useEffect(() => {
    if (!type) return;
    const url = new URL(window.location.href);
    url.searchParams.set("showcase", type);
    window.history.replaceState(null, "", url);
  }, [type]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    (window as unknown as { __showcase?: unknown }).__showcase = {
      list: () => visible.map((e) => ({ type: e.type, label: e.label })),
      all: () => entries.map((e) => ({ type: e.type, label: e.label })),
      goto: (t: string) => setType(t),
      next: () => step(1),
      prev: () => step(-1),
      current: () => type,
    };
  });

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-type="${CSS.escape(type)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [type]);

  const current = FLAT_CATALOG.get(type);
  return (
    <div className="sol-showcase">
      <aside className="sol-showcase__side">
        <input
          className="sol-showcase__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes"
          spellCheck={false}
        />
        <div className="sol-showcase__list" ref={listRef}>
          {visible.map((e) => (
            <button
              key={e.type}
              data-type={e.type}
              className={"sol-showcase__item" + (e.type === type ? " sol-showcase__item--active" : "")}
              onClick={() => setType(e.type)}
            >
              <span className="sol-showcase__item-label">{e.label}</span>
              <span className="sol-showcase__item-type">{e.type}</span>
            </button>
          ))}
        </div>
        <div className="sol-showcase__count">
          {idx >= 0 ? idx + 1 : "–"} / {visible.length}
        </div>
      </aside>
      <main className="sol-showcase__main">
        <header className="sol-showcase__bar">
          <button className="sol-showcase__nav" onClick={() => step(-1)} title="Previous (←)">←</button>
          <button className="sol-showcase__nav" onClick={() => step(1)} title="Next (→)">→</button>
          <span className="sol-showcase__title">{current?.label ?? type}</span>
          <span className="sol-showcase__type">{type}</span>
          <span className="sol-showcase__zoom">
            {[1, 1.5, 2].map((k) => (
              <button
                key={k}
                className={"sol-showcase__nav" + (zoom === k ? " sol-showcase__nav--active" : "")}
                onClick={() => setZoom(k)}
              >
                {k}×
              </button>
            ))}
          </span>
        </header>
        <div ref={stageRef} className="sol-showcase__stage" />
      </main>
      <FormulaPopup />
      <TablePopup />
      <CubePopup />
      <ChartPopup />
      <ElementPicker />
      <PivotEditorPopup />
    </div>
  );
}
