import { useSyncExternalStore } from "react";
import wordmark from "../logo/solenoidwordmark.svg";
import icon from "../logo/solenoidicon.svg";
import { CableShapeSelector } from "./CableShapeSelector";
import { AppToolbar } from "./AppToolbar";
import { TabletActions } from "./TabletActions";
import { autoArrange, cleanup } from "./process";
import { saveToDisk, openFromDisk } from "./fileSession";
import { frStore } from "./frStore";
import { mobileMenuStore } from "./mobileMenuStore";
import { toggleChrome } from "./chromeToggle";
import { DocumentTitle } from "./components/DocumentTitle";
import { useGridSnap } from "./gridSnapStore";
import { toggleAllGroups, groupCollapseSummary } from "./OutlinePanel";
import { groupCollapseStore } from "./groupCollapse";
import "./TopBar.css";

/**
 * Full-width application bar pinned to the top edge. Gathers the brand
 * wordmark, the graph-document controls (example picker, save, open,
 * auto-arrange, function reference), the cable-shape switch, and the
 * accent/theme controls into one strip.
 *
 * Pure *canvas* tools — zoom, fit, lock — stay floating on the canvas in
 * NavMenu, since they act on the viewport rather than the document.
 */
export function TopBar() {
  // Re-render on group collapse/expand so the all-groups toggle's icon + title
  // flip (Expand ↔ Collapse), matching the Navigator button (shared handler — see
  // OutlinePanel).
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);
  const { allCollapsed } = groupCollapseSummary();
  // Snap-to-grid lives with the layout tools (it's about node placement), not the
  // cable-shape switch.
  const { snap, toggleSnap } = useGridSnap();
  return (
    <div
      className="solenoid-topbar"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "?" || (e.key === "/" && e.ctrlKey)) frStore.toggle(); }}
    >
      {/* Masked rather than <img> so the single-color mark recolors per theme
          via --wordmark-color. The full wordmark shows on desktop (a plain,
          non-interactive mark); on a phone it's hidden and the compact square
          icon takes its place — doubling as the app-menu button (the old
          separate hamburger is gone; CSS swaps wordmark↔icon). */}
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
        <span
          className="solenoid-topbar__icon-glyph"
          style={{ WebkitMaskImage: `url("${icon}")`, maskImage: `url("${icon}")` }}
        />
      </button>

      {/* Mobile-only: Navigator (outline) toggle. On desktop the outline has its
          own floating open-pill, so this is CSS-hidden there. */}
      <button
        type="button"
        className="solenoid-topbar__nav"
        aria-label="Navigator"
        title="Navigator"
        onClick={() => toggleChrome("navigator")}
      >
        {/* Same panel-left glyph the desktop navigator open-pill uses. */}
        <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="1.6" />
          <path d="M6 3 V13" />
        </svg>
      </button>

      {/* Mobile-only: the current document name + caret. On desktop it's centered
          in the menu bar; on mobile it moves UP to the thin accent row (the menu
          bar), so this in-app-bar copy is CSS-hidden on mobile now too. */}
      <div className="solenoid-topbar__doctitle">
        <DocumentTitle />
      </div>

      <span className="solenoid-topbar__divider" />

      <div className="solenoid-topbar__group solenoid-topbar__group--file">
        {/* Save: writes the current graph to its .json file (prompting the first
            time). Your work also autosaves to the in-app document continuously. */}
        <button className="solenoid-nav__btn" title="Save (Ctrl+S)" aria-label="Save" onClick={() => void saveToDisk()}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 2.5 h7 L13.5 5.5 V12.5 a1 1 0 0 1 -1 1 H3.5 a1 1 0 0 1 -1 -1 V3.5 a1 1 0 0 1 1 -1 Z" />
            <path d="M5 2.5 V6 h5 V2.5" />
            <rect x="5" y="8.5" width="6" height="5" rx="0.5" />
          </svg>
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

      {/* Layout pill: Tidy + Cleanup + collapse/expand-all together. */}
      <div className="solenoid-topbar__group solenoid-topbar__group--layout">
        <button className="solenoid-nav__btn" title="Tidy: auto-arrange (T)" aria-label="Tidy" onClick={() => autoArrange()}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            {/* One source node branching into two — a tidy graph layout. */}
            <rect x="1.2" y="5.5" width="3.6" height="5" rx="0.8" />
            <rect x="11.2" y="2" width="3.6" height="3.6" rx="0.8" />
            <rect x="11.2" y="9.8" width="3.6" height="3.6" rx="0.8" />
            <path d="M4.8 8 H8" />
            <path d="M8 8 V3.8 H11.2" />
            <path d="M8 8 V11.6 H11.2" />
          </svg>
        </button>
        <button className="solenoid-nav__btn" title="Cleanup: tidy, collapse & fit (C)" aria-label="Cleanup" onClick={() => cleanup()}>
          {/* Lucide "brush" (ISC). */}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m11 10 3 3" />
            <path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z" />
            <path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031" />
          </svg>
        </button>
        {/* Collapse/expand all groups — a duplicate of the Navigator's button
            (shared toggleAllGroups handler), so it's reachable without opening
            the outline. Same chevron icon, flipping when all groups are collapsed. */}
        <button
          className="solenoid-nav__btn"
          title={allCollapsed ? "Expand all groups (E)" : "Collapse all groups (E)"}
          aria-label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
          onClick={() => toggleAllGroups()}
        >
          {/* Lucide list-chevrons — the glyph shows the ACTION: converging
              (down-up) to collapse, diverging (up-down) to expand. */}
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
        {/* Snap to grid — node placement, so it belongs with the layout tools. */}
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

      {/* Find/search lives with the navigator toggle now (see OutlinePanel's
          collapsed pill) — it only opens the navigator + focuses its search. */}

      <span className="solenoid-topbar__divider" />

      <CableShapeSelector />

      {/* Tablet only: the keyboard-less edit actions (a tablet has no bottom bar).
          BEFORE the art slot, so they sit with the other tool pills — and when the
          bar wraps they go to row 2 with them. */}
      <TabletActions />

      {/* Decorative art slot — fills the middle gap. Drop an SVG here later,
          e.g. <img className="solenoid-topbar__art-svg" src={...} /> or inline
          <svg>. Empty for now; it just holds the space. */}
      <div className="solenoid-topbar__art" />

      <AppToolbar />

    </div>
  );
}
