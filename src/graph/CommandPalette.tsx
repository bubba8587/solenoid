import { useEffect, useMemo, useRef, useState } from "react";
import { flattenLeaves, scoreLeaf } from "./catalogSearch";
import { buildCatalog } from "./catalogUtils";
import { fieldScore } from "./fuzzy";
import { getEditor, getArea, autoArrange, cleanup, requestRecalc, processGraph } from "./process";
import { focusNode } from "./OutlinePanel";
import { frStore } from "./frStore";
import { shortcutsStore } from "./shortcutsStore";
import { settingsPanel, settingsStore, SETTINGS_SCHEMA } from "./settingsStore";
import { canvasLockStore } from "./canvasLock";
import { calcModeStore } from "./calcModeStore";
import { addMenuRequest } from "./addMenuStore";
import { outlineSearch } from "./outlineStore";
import { saveToDisk, openFromDisk } from "./fileSession";
import { documentStore } from "./documentStore";
import { isolateStore } from "./isolateStore";
import { alignSelection, distributeSelection, collapseSelection } from "./selectionOps";
import type { NodeCatalogEntry } from "./AddNodeMenu";
import type { SolenoidNode } from "./schemes";
import "./CommandPalette.css";

// Creates + places a picked catalog leaf at the viewport center and renders it —
// the same additive (no-full-recompute) path Canvas's Add-menu pick uses, just
// without a click point to place it at.
async function addNodeAtCenter(entry: NodeCatalogEntry) {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area || isolateStore.isActive()) return;
  const node = entry.create() as SolenoidNode;
  await editor.addNode(node);
  const { x: tx, y: ty, k } = area.area.transform;
  const rect = area.container.getBoundingClientRect();
  const canvasX = (rect.width / 2 - tx) / k;
  const canvasY = (rect.height / 2 - ty) / k;
  await area.translate(node.id, { x: canvasX, y: canvasY });
  await processGraph(undefined, new Set([node.id]));
}

// Reuses the exact "dispatch a synthetic keydown" trick MenuBar's Edit menu
// uses to run graph-domain shortcuts (group/isolate/tidy/…) without a second
// copy of Canvas's keydown logic.
function fireCanvasKey(code: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift, bubbles: true, cancelable: true,
    }),
  );
}

type PaletteItem = {
  id: string;
  kind: "command" | "node" | "jump" | "setting";
  label: string;
  sub?: string;
  shortcut?: string;
  run: () => void;
};

function buildCommands(): PaletteItem[] {
  const locked = canvasLockStore.get();
  const auto = calcModeStore.mode() === "auto";
  return [
    { label: "Add node…", shortcut: "A", run: () => addMenuRequest.open(window.innerWidth / 2, window.innerHeight / 2) },
    { label: "Tidy (auto-arrange)", shortcut: "T", run: () => void autoArrange() },
    { label: "Cleanup (tidy + collapse + fit)", shortcut: "C", run: () => void cleanup() },
    { label: "Calculate now", shortcut: "F9", run: () => void requestRecalc() },
    { label: auto ? "Switch to manual calculation" : "Switch to automatic calculation", run: () => calcModeStore.setMode(auto ? "manual" : "auto") },
    { label: "Group selection", shortcut: "G", run: () => fireCanvasKey("KeyG") },
    { label: "Isolate selection", shortcut: "I", run: () => fireCanvasKey("KeyI") },
    { label: "Expand/collapse groups", shortcut: "E", run: () => fireCanvasKey("KeyE") },
    { label: "Autofit group box", shortcut: "F", run: () => fireCanvasKey("KeyF") },
    { label: "Align left", run: () => void alignSelection("left") },
    { label: "Align right", run: () => void alignSelection("right") },
    { label: "Align top", run: () => void alignSelection("top") },
    { label: "Align bottom", run: () => void alignSelection("bottom") },
    { label: "Align center (horizontal)", run: () => void alignSelection("center-h") },
    { label: "Align center (vertical)", run: () => void alignSelection("center-v") },
    { label: "Distribute horizontally", run: () => void distributeSelection("h") },
    { label: "Distribute vertically", run: () => void distributeSelection("v") },
    { label: "Collapse selection", run: () => collapseSelection(true) },
    { label: "Expand selection", run: () => collapseSelection(false) },
    { label: "Undo", shortcut: "Ctrl+Z", run: () => fireCanvasKey("KeyZ", { ctrl: true }) },
    { label: "Redo", shortcut: "Ctrl+Shift+Z", run: () => fireCanvasKey("KeyZ", { ctrl: true, shift: true }) },
    { label: locked ? "Unlock canvas" : "Lock canvas", run: () => canvasLockStore.toggle() },
    { label: "Find node…", shortcut: "Ctrl+F", run: () => outlineSearch.open() },
    { label: "Function reference", shortcut: "Ctrl+/", run: () => frStore.open("reference") },
    { label: "Keyboard shortcuts", run: () => shortcutsStore.toggle() },
    { label: "Settings…", shortcut: "Ctrl+,", run: () => settingsPanel.open() },
    { label: "Save", shortcut: "Ctrl+S", run: () => void saveToDisk() },
    { label: "Save As…", shortcut: "Ctrl+Shift+S", run: () => void saveToDisk({ forceDialog: true }) },
    { label: "Open…", shortcut: "Ctrl+O", run: () => void openFromDisk() },
    { label: "New blank document", run: () => void documentStore.newBlank() },
    { label: "Reload document", shortcut: "Ctrl+Shift+L", run: () => void documentStore.reloadCurrent() },
  ].map((c, i) => ({ id: `cmd:${i}:${c.label}`, kind: "command" as const, ...c }));
}

function buildSettingToggles(): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const section of SETTINGS_SCHEMA) {
    for (const f of section.fields) {
      if (f.type === "folder" || f.type === "segment") continue;
      out.push({
        id: `setting:${f.key}`,
        kind: "setting",
        label: `Toggle ${f.label}`,
        sub: settingsStore.get(f.key) ? "on" : "off",
        run: () => settingsStore.toggle(f.key as Parameters<typeof settingsStore.toggle>[0]),
      });
    }
  }
  return out;
}

function typeLabel(n: unknown): string {
  return (n as { constructor: { name: string } }).constructor.name
    .replace(/Node$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(buildCommands, []);
  const toggles = useMemo(buildSettingToggles, []);
  const leaves = useMemo(() => flattenLeaves(buildCatalog(true)), []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => setActiveIndex(0), [query]);

  const results = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    if (!q) return commands.slice(0, 8);
    const scored: { item: PaletteItem; score: number }[] = [];
    for (const c of [...commands, ...toggles]) {
      const s = fieldScore(q, c.label);
      if (s !== null) scored.push({ item: c, score: s });
    }
    const editor = getEditor();
    if (editor) {
      for (const n of editor.getNodes()) {
        const label = (n as { label?: string }).label || "Node";
        const s = fieldScore(q, label);
        if (s === null) continue;
        scored.push({
          score: s,
          item: {
            id: `jump:${n.id}`,
            kind: "jump",
            label,
            sub: typeLabel(n),
            run: () => void focusNode(n.id),
          },
        });
      }
    }
    for (const lc of leaves) {
      const s = scoreLeaf(q, lc);
      if (s === null) continue;
      const leaf: NodeCatalogEntry = lc.leaf;
      scored.push({
        // Node-add results rank a shade under equally-scored commands/jumps —
        // adding a node is the highest-commitment action of the four.
        score: s - 5,
        item: {
          id: `node:${leaf.type}`,
          kind: "node",
          label: leaf.label,
          sub: "Add node",
          run: () => void addNodeAtCenter(leaf),
        },
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 20).map((s) => s.item);
  }, [query, commands, toggles, leaves]);

  function run(item: PaletteItem) {
    item.run();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[activeIndex]) run(results[activeIndex]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  return (
    <div className="solenoid-cmdpalette-scrim" onMouseDown={onClose}>
      <div className="solenoid-cmdpalette" onMouseDown={(e) => e.stopPropagation()}>
        {results.length > 0 && (
          <div className="solenoid-cmdpalette__results">
            {results.map((r, i) => (
              <div
                key={r.id}
                className={`solenoid-cmdpalette__item${i === activeIndex ? " solenoid-cmdpalette__item--active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => run(r)}
              >
                <span className="solenoid-cmdpalette__label">{r.label}</span>
                {r.sub && <span className="solenoid-cmdpalette__sub">{r.sub}</span>}
                {r.shortcut && <span className="solenoid-cmdpalette__shortcut">{r.shortcut}</span>}
              </div>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          className="solenoid-cmdpalette__input"
          value={query}
          spellCheck={false}
          placeholder="Add a node, run a command, jump to a node…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
