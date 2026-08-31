import { useSyncExternalStore, useState, useEffect, useRef } from "react";
import wordmark from "../logo/solenoidwordmark.svg";
import { TidyOptionsPopover } from "./TidyOptionsPopover";
import { CableShapeSelector } from "./CableShapeSelector";
import { AppToolbar } from "./AppToolbar";
import { TabletActions } from "./TabletActions";
import { autoArrange, cleanup } from "./canvasCommands";
import { saveToDisk, openFromDisk } from "./fileSession";
import { frStore } from "./frStore";
import { mobileMenuStore } from "./mobileMenuStore";
import { toggleChrome } from "./chromeToggle";
import { DocumentTitle } from "./components/DocumentTitle";
import { SaveIcon } from "./components/SaveIcon";
import { useGridSnap } from "./gridSnapStore";
import { toggleAllGroups, groupCollapseSummary } from "./OutlinePanel";
import { groupCollapseStore } from "./groupCollapse";
import "./TopBar.css";

export function TopBar() {
  // Re-render on group collapse/expand so the all-groups toggle's icon + title flip.
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);
  const { allCollapsed } = groupCollapseSummary();
  const { snap, toggleSnap } = useGridSnap();
  const [tidyOptsOpen, setTidyOptsOpen] = useState(false);
  const layoutGroupRef = useRef<HTMLDivElement>(null);
  // Clickaway: a pointerdown outside the layout group (opener + popover live inside it) closes.
  useEffect(() => {
    if (!tidyOptsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!layoutGroupRef.current?.contains(e.target as Node)) setTidyOptsOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [tidyOptsOpen]);
  return (
    <div
      className="solenoid-topbar"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "?" || (e.key === "/" && e.ctrlKey)) frStore.toggle(); }}
    >
      {/* Masked, not <img>, so the mark recolors per theme; CSS swaps wordmark↔icon
          on a phone, where the icon doubles as the app-menu button. */}
      <span
        className="solenoid-topbar__mark"
        role="img"
        aria-label="Solenoid"
        style={{ WebkitMaskImage: `url("${wordmark}")`, maskImage: `url("${wordmark}")` }}
      />
      <button
        type="button"
        className="solenoid-topbar__icon"
        aria-label="Menu"
        onClick={() => mobileMenuStore.toggle()}
      >
        {/* Standard overflow dots (the PopupOverflowMenu glyph, turned vertical) —
            the brand mark moved to the mobile menu bar's wordmark. */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>

      {/* Mobile-only: on desktop the outline has its own pill, so this is CSS-hidden. */}
      <button
        type="button"
        className="solenoid-topbar__nav"
        aria-label="Navigator"
        title="Navigator"
        onClick={() => toggleChrome("navigator")}
      >
        <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="1.6" />
          <path d="M6 3 V13" />
        </svg>
      </button>

      {/* CSS-hidden on mobile, where the name moves up into the menu bar. */}
      <div className="solenoid-topbar__doctitle">
        <DocumentTitle />
      </div>

      <span className="solenoid-topbar__divider" />

      <div className="solenoid-topbar__group solenoid-topbar__group--file">
        <button className="solenoid-nav__btn" title="Save (Ctrl+S)" aria-label="Save" onClick={() => void saveToDisk()}>
          <SaveIcon />
        </button>
        <button className="solenoid-nav__btn" title="Save As: save to a new file (Ctrl+Shift+S)" aria-label="Save As" onClick={() => void saveToDisk({ forceDialog: true })}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2.5 V10" /><path d="M5 7 8 10 11 7" /><path d="M3 12.5 h10" />
          </svg>
        </button>
        <button className="solenoid-nav__btn" title="Open a graph file (Ctrl+O)" aria-label="Open" onClick={() => void openFromDisk()}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 10.5 V3" /><path d="M5 6 8 3 11 6" /><path d="M3 12.5 h10" />
          </svg>
        </button>
      </div>

      <div className="solenoid-topbar__group solenoid-topbar__group--layout" ref={layoutGroupRef}>
        <button className="solenoid-nav__btn" title="Tidy: auto-arrange (T)" aria-label="Tidy" onClick={() => autoArrange()}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.2" y="5.5" width="3.6" height="5" rx="0.8" />
            <rect x="11.2" y="2" width="3.6" height="3.6" rx="0.8" />
            <rect x="11.2" y="9.8" width="3.6" height="3.6" rx="0.8" />
            <path d="M4.8 8 H8" />
            <path d="M8 8 V3.8 H11.2" />
            <path d="M8 8 V11.6 H11.2" />
          </svg>
        </button>
        <button
          className="solenoid-nav__btn solenoid-topbar__tidy-opts"
          title="Tidy options"
          aria-label="Tidy options"
          aria-haspopup="dialog"
          aria-expanded={tidyOptsOpen}
          onClick={() => setTidyOptsOpen((o) => !o)}
        >
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6 L8 10 L12 6" />
          </svg>
        </button>
        {tidyOptsOpen && <TidyOptionsPopover onClose={() => setTidyOptsOpen(false)} />}
        <button className="solenoid-nav__btn" title="Cleanup: tidy, collapse, and fit (C)" aria-label="Cleanup" onClick={() => cleanup()}>
          {/* Lucide "brush" (ISC). */}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m11 10 3 3" />
            <path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z" />
            <path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031" />
          </svg>
        </button>
        {/* A duplicate of the Navigator's button (shared toggleAllGroups handler). */}
        <button
          className="solenoid-nav__btn"
          title={allCollapsed ? "Expand all groups (E)" : "Collapse all groups (E)"}
          aria-label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
          onClick={() => toggleAllGroups()}
        >
          {/* The glyph shows the ACTION: converging to collapse, diverging to expand. */}
          <svg
            viewBox="0 0 16 16" width="14" height="14" fill="none"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M2 4 H8" />
            <path d="M2 8 H8" />
            <path d="M2 12 H8" />
            {allCollapsed ? (
              <>
                <path d="M10 6 L12 4 L14 6" />
                <path d="M10 10 L12 12 L14 10" />
              </>
            ) : (
              <>
                <path d="M10 4 L12 6 L14 4" />
                <path d="M10 12 L12 10 L14 12" />
              </>
            )}
          </svg>
        </button>
        <button
          className={`solenoid-nav__btn${snap ? " solenoid-nav__btn--on" : ""}`}
          title={snap ? "Snap to grid: on" : "Snap to grid: off"}
          aria-label="Snap to grid"
          aria-pressed={snap}
          onClick={toggleSnap}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <g fill="currentColor">
              <circle cx="3" cy="3" r="1" opacity="0.5" />
              <circle cx="8" cy="3" r="1" opacity="0.5" />
              <circle cx="13" cy="3" r="1" opacity="0.5" />
              <circle cx="3" cy="8" r="1" opacity="0.5" />
              <circle cx="13" cy="8" r="1" opacity="0.5" />
              <circle cx="3" cy="13" r="1" opacity="0.5" />
              <circle cx="8" cy="13" r="1" opacity="0.5" />
              <circle cx="13" cy="13" r="1" opacity="0.5" />
            </g>
            <rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" />
          </svg>
        </button>
      </div>

      <span className="solenoid-topbar__divider" />

      <CableShapeSelector />

      {/* Tablet only (no bottom bar there); BEFORE the art slot so a wrap keeps them
          with the other tool pills. */}
      <TabletActions />

      {/* Decorative art slot — fills the middle gap; empty for now. */}
      <div className="solenoid-topbar__art" />

      <AppToolbar />

    </div>
  );
}
