import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "./appTheme";
import { canvasLockStore } from "./canvasLock";
import { calcModeStore } from "./calcModeStore";
import { mobileMenuStore } from "./mobileMenuStore";
import { DocumentTitle } from "./components/DocumentTitle";
import { useEscapeToClose } from "./components/useEscapeToClose";
import { CableShapeSelector } from "./CableShapeSelector";
import { useGridSnap } from "./gridSnapStore";
import { buildMenus, type MenuItem } from "./menuModel";
import { commandRecents } from "./commandRecents";
import "./MenuBar.css";

/** Renders only — the MODEL lives in `menuModel.ts`, shared with the Command Palette
 *  so every action is in both. */

export function MenuBar() {
  // Subscribed for re-render only — the values are read inside buildMenus().
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  useSyncExternalStore(calcModeStore.subscribe, calcModeStore.version);
  useGridSnap();
  const menus = buildMenus();

  const [open, setOpen] = useState<number | null>(null);
  // Bridges the mobile app-bar button (in TopBar) to the sheet below.
  const mobileOpen = useSyncExternalStore(mobileMenuStore.subscribe, mobileMenuStore.get);
  const rootRef = useRef<HTMLDivElement>(null);

  useEscapeToClose(() => { setOpen(null); mobileMenuStore.set(false); }, open !== null || mobileOpen);
  useEffect(() => {
    if (open === null && !mobileOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      // Ignore the mobile menu trigger, or its own toggle is undone here first.
      if (t?.closest(".solenoid-topbar__icon")) return;
      if (!rootRef.current?.contains(t)) { setOpen(null); mobileMenuStore.set(false); }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, mobileOpen]);

  const run = (it: MenuItem) => {
    if ("sep" in it || it.disabled) return;
    commandRecents.record(it.label);
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

      <div className="solenoid-menubar__center">
        <DocumentTitle />
      </div>

      {mobileOpen && (
        <div className="solenoid-menubar__sheet">
          {/* The top bar's cable controls are hidden on touch — this is their only
              mobile home, on the same module stores as the desktop instance. */}
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
