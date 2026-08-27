import { useEffect, useMemo, useRef, useState } from "react";
import type { SolenoidNode } from "../schemes";
import { makeStaticStack, StaticFlowStage } from "../flow/StaticFlowStage";
import { FLAT_CATALOG } from "../catalogUtils";
import { setEditorRefs, processGraph } from "../process";
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
  const listRef = useRef<HTMLDivElement>(null);
  const stack = useMemo(makeStaticStack, []);

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

  // The same flow stage as the canvas, so the card here IS the real one.
  // Point the module singletons at THIS stack; safe only because the app canvas
  // never mounts in showcase mode, so no persistence hook can reach documents.
  useEffect(() => {
    setEditorRefs(stack.editor, stack.engine, stack.area);
  }, [stack]);

  useEffect(() => {
    if (!type) return;
    let canceled = false;
    void (async () => {
      await stack.editor.clear();
      const entry = FLAT_CATALOG.get(type);
      if (!entry || canceled) return;
      const node = entry.create() as unknown as SolenoidNode;
      await stack.editor.addNode(node);
      if (canceled) return;
      nodeNameStore.ensure(node.id, node.constructor.name);
      await stack.area.moveNode(node.id, { x: PAD, y: PAD });
      await processGraph();
    })();
    return () => { canceled = true; };
  }, [stack, type]);

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
        <div className="sol-showcase__stage">
          <StaticFlowStage stack={stack} zoom={zoom} />
        </div>
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
