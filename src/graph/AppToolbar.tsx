import { useRef, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "./appTheme";
import { settingsPanel } from "./settingsStore";
import { frStore } from "./frStore";
import { inspectorStore } from "./inspectorStore";
import { SwatchGrid } from "./components/SwatchGrid";
import { useDismissOnOutside } from "./components/useDismissOnOutside";
import { resolveColor } from "./palette";
import "./AppToolbar.css";

/** The accent picker and theme toggle; both drive `appThemeStore`, which writes the CSS
 *  variables on <html>. */
export function AppToolbar() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const accent = appThemeStore.getAccent();
  const mode = appThemeStore.getMode();
  const [pickerOpen, setPickerOpen] = useState(false);
  const paintRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(pickerOpen, () => setPickerOpen(false), [paintRef, paletteRef]);
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <div className="solenoid-apptools" onPointerDown={stop} onMouseDown={stop}>
      {/* Accent picker + theme toggle share one pill. */}
      <div className="solenoid-apptools__pill">
        <button
          type="button"
          ref={paintRef}
          className="solenoid-apptools__btn solenoid-apptools__paint"
          title="Accent color"
          aria-label="Accent color"
          onClick={() => setPickerOpen((o) => !o)}
        >
          {/* Lucide "paintbrush" (ISC) — the accent shows as the small dot. */}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
            <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
            <path d="M14.5 17.5 4.5 15" />
          </svg>
          <span className="solenoid-apptools__paint-dot" style={{ background: resolveColor(accent) }} />
        </button>
        {pickerOpen && (
          <div ref={paletteRef} className="solenoid-apptools__palette">
            <SwatchGrid
              value={accent}
              onPick={(c) => appThemeStore.setAccent(c)}
            />
            {/* Mobile-only: the light/dark toggle lives in the palette popup to
                save app-bar space (the standalone button is hidden on touch). */}
            <button
              type="button"
              className="solenoid-apptools__palette-theme"
              onClick={() => appThemeStore.toggleMode()}
            >
              <ThemeGlyph mode={mode} />
              <span>{mode === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>
          </div>
        )}
        <button
          type="button"
          className="solenoid-apptools__btn solenoid-apptools__theme"
          title={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle light and dark theme"
          onClick={() => appThemeStore.toggleMode()}
        >
          <ThemeGlyph mode={mode} />
        </button>
      </div>
      <button
        type="button"
        className="solenoid-apptools__btn"
        title="Reference (Ctrl+/)"
        aria-label="Reference"
        onClick={() => frStore.toggle()}
      >
        {/* Lucide "book-open" (ISC). */}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      </button>
      <button
        type="button"
        className="solenoid-apptools__btn solenoid-apptools__inspector"
        title="Inspector"
        aria-label="Inspector"
        onClick={() => inspectorStore.toggle()}
      >
        {/* Lucide "info" (ISC). */}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      <button
        type="button"
        className="solenoid-apptools__btn"
        title="Settings"
        aria-label="Settings"
        onClick={() => settingsPanel.toggle()}
      >
        {/* Lucide "settings" gear (ISC). */}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}

/** Moon (currently dark → offers light) / sun (currently light → offers dark). */
function ThemeGlyph({ mode }: { mode: string }) {
  return mode === "dark" ? (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13" />
    </svg>
  );
}
