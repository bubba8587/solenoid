import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "./appTheme";
import { canvasLockStore } from "./canvasLock";
import { calcModeStore } from "./calcModeStore";
import { mobileMenuStore } from "./mobileMenuStore";
import { DocumentTitle } from "./components/DocumentTitle";
import { CableShapeSelector } from "./CableShapeSelector";
import { useGridSnap } from "./gridSnapStore";
import { buildMenus, type MenuItem } from "./menuModel";
import { commandRecents } from "./commandRecents";
import "./MenuBar.css";

/**
 * Desktop-style application menu bar (File / Edit / View / Insert / Data /
 * Calculate / Help). The menu MODEL lives in `menuModel.ts` (shared with the
 * Command Palette so every action is in both); this component just renders it.
 * Edit commands reuse Canvas's window-keydown handlers via synthetic key events,
 * so undo/redo/copy/paste/delete/select-all stay single-sourced.
 */

export function MenuBar() {
  // Subscribe so the menu re-renders (checkmarks/labels) when these change; the
  // values themselves are read inside buildMenus().
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  useSyncExternalStore(calcModeStore.subscribe, calcModeStore.version);
  useGridSnap();
  const menus = buildMenus();

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

  const run = (it: MenuItem) => {
    if ("sep" in it || it.disabled) return;
    commandRecents.record(it.label); // feed the palette's recent-actions suggestions
    it.onClick?.();
    setOpen(null);
    mobileMenuStore.set(false);
  };

  const renderOption = (it: MenuItem, j: number) =>
    "sep" in it ? (
      <div key={j} className="solenoid-menubar__sep" />
    ) : (
      <button
        key={j}
        type="button"
        className="solenoid-menubar__option"
        disabled={it.disabled}
        onClick={() => run(it)}
      >
        <span className="solenoid-menubar__check">{it.checked ? "✓" : ""}</span>
        <span className="solenoid-menubar__label">{it.label}</span>
        {it.shortcut && <span className="solenoid-menubar__shortcut">{it.shortcut}</span>}
      </button>
    );


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
