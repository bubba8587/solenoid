import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "./appTheme";
import { canvasLockStore } from "./canvasLock";
import { frStore } from "./frStore";
import { shortcutsStore } from "./shortcutsStore";
import { outlineSearch } from "./outlineStore";
import { autoArrange, cleanup, requestRecalc } from "./process";
import { calcModeStore } from "./calcModeStore";
import { refreshAllConnections } from "./connectionStore";
import { saveToDisk, openFromDisk } from "./fileSession";
import { documentStore } from "./documentStore";
import { addMenuRequest } from "./addMenuStore";
import { connectionDialog } from "./connectionDialogStore";
import { mobileMenuStore } from "./mobileMenuStore";
import { settingsPanel } from "./settingsStore";
import { rendererSpikeStore } from "./rendererSpikeStore";
import { htmlCanvasSpikeStore } from "./htmlCanvasSpikeStore";
import { DocumentTitle } from "./components/DocumentTitle";
import { CableShapeSelector } from "./CableShapeSelector";
import { useGridSnap } from "./gridSnapStore";
import "./MenuBar.css";

/**
 * Desktop-style application menu bar (File / Edit / View / Insert / Data /
 * Calculate / Help). Edit commands reuse Canvas's existing window-keydown
 * handlers via synthetic key events, so undo/redo/copy/paste/delete/select-all
 * stay single-sourced. Items not yet implemented are shown disabled so the
 * structure is discoverable.
 */

type MenuItem =
  | { sep: true }
  | { label: string; shortcut?: string; onClick?: () => void; disabled?: boolean; checked?: boolean };
type Menu = { label: string; items: MenuItem[] };

// Dispatch a synthetic keydown so the Canvas keyboard handler runs the real
// command (it listens on window). Reuses all the existing edit logic.
function fireKey(code: string, opts: { key?: string; ctrl?: boolean; shift?: boolean } = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code,
      key: opts.key ?? "",
      ctrlKey: !!opts.ctrl,
      shiftKey: !!opts.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function MenuBar() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  useSyncExternalStore(calcModeStore.subscribe, calcModeStore.version);
  const calcMode = calcModeStore.mode();
  const { snap, toggleSnap } = useGridSnap();
  const mode = appThemeStore.getMode();

  const [open, setOpen] = useState<number | null>(null);
  // Mobile: the whole bar collapses behind the app-bar logo button (rendered in
  // TopBar) that opens one scrolling sheet of every menu as a section, so the
  // menus don't need their own row. This store bridges the button to the sheet.
  const mobileOpen = useSyncExternalStore(mobileMenuStore.subscribe, mobileMenuStore.get);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (open === null && !mobileOpen) return;
    const close = () => { setOpen(null); mobileMenuStore.set(false); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      // Ignore the app-bar logo button (the menu trigger on mobile) so its own
      // toggle isn't immediately undone by this outside-click handler.
      if (t?.closest(".solenoid-topbar__icon")) return;
      if (!rootRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, mobileOpen]);

  const run = (fn?: () => void) => { fn?.(); setOpen(null); mobileMenuStore.set(false); };

  const renderOption = (it: MenuItem, j: number) =>
    "sep" in it ? (
      <div key={j} className="solenoid-menubar__sep" />
    ) : (
      <button
        key={j}
        type="button"
        className="solenoid-menubar__option"
        disabled={it.disabled}
        onClick={() => run(it.onClick)}
      >
        <span className="solenoid-menubar__check">{it.checked ? "✓" : ""}</span>
        <span className="solenoid-menubar__label">{it.label}</span>
        {it.shortcut && <span className="solenoid-menubar__shortcut">{it.shortcut}</span>}
      </button>
    );

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New blank document", onClick: () => void documentStore.newBlank() },
        { label: "Open…", shortcut: "Ctrl+O", onClick: () => void openFromDisk() },
        { sep: true },
        // Work autosaves to the in-app document continuously; Save writes the
        // graph out to its .json file (prompting for one the first time).
        { label: "Save", shortcut: "Ctrl+S", onClick: () => void saveToDisk() },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", onClick: () => void saveToDisk({ forceDialog: true }) },
        { sep: true },
        // A genuine reload of the current document (full rebuild from the saved
        // graph), which replays the cinematic load reveal — a browser refresh
        // doesn't. A deliberate combo, not a stray single key.
        { label: "Reload document", shortcut: "Ctrl+Shift+L", onClick: () => void documentStore.reloadCurrent() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", onClick: () => fireKey("KeyZ", { ctrl: true }) },
        { label: "Redo", shortcut: "Ctrl+Shift+Z", onClick: () => fireKey("KeyZ", { ctrl: true, shift: true }) },
        { sep: true },
        { label: "Copy", shortcut: "Ctrl+C", onClick: () => fireKey("KeyC", { ctrl: true }) },
        { label: "Paste", shortcut: "Ctrl+V", onClick: () => fireKey("KeyV", { ctrl: true }) },
        { label: "Delete", shortcut: "Del", onClick: () => fireKey("Delete", { key: "Delete" }) },
        { sep: true },
        { label: "Select all", shortcut: "Ctrl+A", onClick: () => fireKey("KeyA", { ctrl: true }) },
        { label: "Group selection", shortcut: "G", onClick: () => fireKey("KeyG") },
        { label: "Make composite", shortcut: "Ctrl+Shift+G", onClick: () => fireKey("KeyG", { ctrl: true, shift: true }) },
        { label: "Autofit group box", shortcut: "F", onClick: () => fireKey("KeyF") },
        { sep: true },
        { label: "Find node…", shortcut: "Ctrl+F", onClick: () => outlineSearch.open() },
        { sep: true },
        // Buried dev tool: a throwaway PixiJS proof-of-architecture that covers
        // the canvas with a GPU-rendered node/cable scene to measure fps at high
        // counts during pan/zoom/drag. See docs/renderer-decision.md.
        { label: "Renderer spike (Pixi)", onClick: () => rendererSpikeStore.open() },
        // Native HTML-in-Canvas (drawElementImage): draws the REAL node DOM into a
        // canvas — auto-fidelity, crisp at any zoom. Chrome flag required.
        { label: "Renderer spike (HTML-in-Canvas)", onClick: () => htmlCanvasSpikeStore.open() },
      ],
    },
    {
      label: "View",
      items: [
        { label: mode === "dark" ? "Light theme" : "Dark theme", onClick: () => appThemeStore.toggleMode() },
        { label: "Lock canvas", checked: locked, onClick: () => canvasLockStore.toggle() },
        { sep: true },
        { label: "Tidy (auto-arrange)", shortcut: "T", onClick: () => autoArrange() },
        { label: "Cleanup (tidy + collapse + fit)", shortcut: "C", onClick: () => cleanup() },
        { label: "Snap to grid", checked: snap, onClick: () => toggleSnap() },
        { sep: true },
        { label: "Function reference", shortcut: "Ctrl+/", onClick: () => frStore.open("reference") },
        { label: "Settings…", shortcut: "Ctrl+,", onClick: () => settingsPanel.open() },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Add node…", shortcut: "A", onClick: () => addMenuRequest.open(window.innerWidth / 2, 140) },
        { label: "Add connection…", onClick: () => connectionDialog.open() },
      ],
    },
    {
      label: "Data",
      items: [
        { label: "Refresh all connections", onClick: () => void refreshAllConnections() },
      ],
    },
    {
      label: "Calculate",
      items: [
        { label: "Calculate now", shortcut: "F9", onClick: () => void requestRecalc() },
        { sep: true },
        {
          label: "Automatic",
          checked: calcMode === "auto",
          // Switching to Automatic catches up on everything suppressed while manual.
          onClick: () => { if (calcModeStore.setMode("auto")) void requestRecalc(); },
        },
        {
          label: "Manual",
          checked: calcMode === "manual",
          onClick: () => { calcModeStore.setMode("manual"); },
        },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Function reference", shortcut: "Ctrl+/", onClick: () => frStore.open("reference") },
        { label: "Help", onClick: () => frStore.open("help") },
        { label: "Notes", onClick: () => frStore.open("notes") },
        { sep: true },
        { label: "Keyboard shortcuts…", onClick: () => shortcutsStore.toggle() },
        { label: "About Solenoid", disabled: true },
      ],
    },
  ];

  return (
    <div className="solenoid-menubar" ref={rootRef} data-tauri-drag-region onPointerDown={(e) => e.stopPropagation()}>
      {menus.map((menu, i) => (
        <div key={menu.label} className="solenoid-menubar__item">
          <button
            type="button"
            className={`solenoid-menubar__top${open === i ? " solenoid-menubar__top--open" : ""}`}
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => { if (open !== null) setOpen(i); }}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="solenoid-menubar__dropdown">
              {menu.items.map((it, j) => renderOption(it, j))}
            </div>
          )}
        </div>
      ))}

      {/* Current document name, centered (desktop only — see mobile.css). Click
          to rename; the ▾ caret opens the documents menu. */}
      <div className="solenoid-menubar__center">
        <DocumentTitle />
      </div>

      {/* Mobile: one sheet listing every menu as a section, opened by the app
          bar's hamburger. Hidden on desktop via CSS. */}
      {mobileOpen && (
        <div className="solenoid-menubar__sheet">
          {/* (The document name + caret lives in the app bar on mobile, not here.) */}
          {/* The top bar's cable controls (shape + flow animation) are hidden
              on touch — this is their only mobile home. Reads/writes the same
              module stores as the desktop instance. */}
          <div className="solenoid-menubar__sheet-section">
            <div className="solenoid-menubar__sheet-heading">Cables</div>
            <CableShapeSelector />
          </div>
          {menus.map((menu) => (
            <div key={menu.label} className="solenoid-menubar__sheet-section">
              <div className="solenoid-menubar__sheet-heading">{menu.label}</div>
              {menu.items.map((it, j) => renderOption(it, j))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
