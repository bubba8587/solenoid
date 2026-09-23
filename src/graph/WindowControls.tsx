import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isDesktop } from "./fileBridge";
import "./WindowControls.css";

// linux shim for window controls (tree/specs/canvas/layout-chrome.md)
export const OWN_WINDOW_CONTROLS =
  isDesktop() && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

const appWindow = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());

const Glyph = ({ d }: { d: string }) => (
  <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth="1" style={{ display: "block" }} aria-hidden="true">
    <path d={d} />
  </svg>
);

const GRIPS = ["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"] as const;

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    void appWindow().then(async (w) => {
      const sync = () => void Promise.all([w.isMaximized(), w.isFullscreen()]).then(([m, f]) => {
        if (!gone) { setMaximized(m); setFullscreen(f); }
      });
      sync();
      const un = await w.onResized(sync);
      if (gone) un(); else off = un;
    });
    return () => { gone = true; off?.(); };
  }, []);

  return (
    <div className="solenoid-wincontrols">
      <button type="button" className="solenoid-wincontrols__btn" title="Minimize" aria-label="Minimize" onClick={() => void appWindow().then((w) => w.minimize())}>
        <Glyph d="M0.5 5.5 H9.5" />
      </button>
      <button
        type="button"
        className="solenoid-wincontrols__btn"
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void appWindow().then((w) => w.toggleMaximize())}
      >
        <Glyph d={maximized ? "M0.5 2.5 H7.5 V9.5 H0.5 Z M2.5 2.5 V0.5 H9.5 V7.5 H7.5" : "M0.5 0.5 H9.5 V9.5 H0.5 Z"} />
      </button>
      <button type="button" className="solenoid-wincontrols__btn solenoid-wincontrols__btn--close" title="Close" aria-label="Close" onClick={() => void appWindow().then((w) => w.close())}>
        <Glyph d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" />
      </button>
      {!maximized && !fullscreen && createPortal(
        GRIPS.map((dir) => (
          <div
            key={dir}
            className={`solenoid-wingrip solenoid-wingrip--${dir}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              void appWindow().then((w) => w.startResizeDragging(dir));
            }}
          />
        )),
        document.body,
      )}
    </div>
  );
}
