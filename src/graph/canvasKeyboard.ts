// Canvas keyboard shortcuts (extracted from Canvas.tsx). Skipped when focus is
// in an editable form element so typing in a label / number field doesn't fire
// them. Graph actions are single letters (hands stay on the graph); OS
// conventions keep their Ctrl form.
//   A add node · I isolate · G group · T tidy · E expand/collapse groups
//   F autofit groups · C cleanup · Del delete · Esc exit isolate
//   Ctrl+Z/Y undo/redo · Ctrl+C/V copy/paste · Ctrl+A select all
//   Ctrl+S save · Ctrl+O open · Ctrl+/ reference · Ctrl+, settings
import type { MutableRefObject } from "react";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { HistoryPlugin } from "rete-history-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import {
  processGraph, bumpConduitAngle, repositionDockedNodes,
  unselectAllNodes as unselectAllNodesFromProcess,
  selectNode as selectNodeFromProcess,
  cleanup as cleanupGraph, autoArrange as tidyGraph, requestRecalc,
  withGraphRebuild,
} from "./process";
import { copySelected, pasteClipboard } from "./copyPaste";
import { createCompositeFromSelection } from "./compositeLogic";
import { compositeEditorStore } from "./compositeEditorStore";
import { presentationStore } from "./presentationStore";
import { paletteStore } from "./paletteStore";
import { frStore } from "./frStore";
import { shortcutsStore } from "./shortcutsStore";
import { settingsPanel } from "./settingsStore";
import { cableSelectionStore } from "./cableState";
import { ConduitNode, AngleDialNode, GroupNode } from "./rete-nodes";
import { toggleAllChrome, toggleChrome } from "./chromeToggle";
import { createGroupFromSelection, autofitGroupWithHistory } from "./groupLogic";
import { setGroupsCollapsed } from "./groupPush";
import { standoffStore, settleStandoffs, anchorFromVector, ANCHOR_DIR } from "./standoffs";
import { isolateStore } from "./isolateStore";
import { isolateSelection } from "./isolate";
import { addMenuRequest } from "./addMenuStore";
import { expandMoveSet } from "./selectionOps";
import { scheduleAutosave } from "./persistence";
import { saveToDisk, openFromDisk } from "./fileSession";
import { DOT_SPACING } from "./gridSnapStore";
import { computeOverlayStore } from "./computeOverlayStore";
import { documentStore } from "./documentStore";

export interface CanvasKeyboardDeps {
  editorRef: MutableRefObject<NodeEditor<Schemes> | null>;
  areaRef: MutableRefObject<AreaPlugin<Schemes, AreaExtra> | null>;
  historyRef: MutableRefObject<HistoryPlugin<Schemes> | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  screenMouseRef: MutableRefObject<{ x: number; y: number }>;
  /** Live "is the Add/quick-wire menu open" check for the bare-Enter palette guard. */
  isAddMenuOpen: () => boolean;
  deleteSelected: () => Promise<void>;
}

// Installs the window-level keydown handler; returns the remover.
export function installCanvasKeyboard(deps: CanvasKeyboardDeps): () => void {
  const { editorRef, areaRef, historyRef, containerRef, screenMouseRef, isAddMenuOpen, deleteSelected } = deps;

  // Expand/collapse + autofit resolve the same target set: selected groups +
  // the group of any selected member, or all groups when nothing is selected.
  // Factored out so the key handler stays readable.
  function resolveGroupTargets(): GroupNode[] {
    const editor = editorRef.current;
    if (!editor) return [];
    const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
    if (groups.length === 0) return [];
    const selected = editor.getNodes().filter((n) => (n as { selected?: boolean }).selected);
    if (selected.length === 0) return groups;
    const set = new Set<GroupNode>();
    for (const n of selected) {
      if (n instanceof GroupNode) set.add(n);
      else { const g = groups.find((gr) => gr.members.includes(n.id)); if (g) set.add(g); }
    }
    return [...set];
  }
  function expandCollapseGroups() {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    const targets = resolveGroupTargets();
    if (targets.length === 0) return;
    const collapse = targets.some((g) => !g.collapsed); // any expanded → collapse all
    // Persist the collapse state (saved via each Group's init.collapsed) — else
    // an expand/collapse was lost on reload.
    void setGroupsCollapsed(editor, area, targets, collapse).then(() => scheduleAutosave());
  }
  function autofitGroups() {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    const targets = resolveGroupTargets();
    void (async () => { for (const g of targets) await autofitGroupWithHistory(editor, area, g); })();
  }
  // `[` / `]` rotate whatever rotatable thing is selected by one step in
  // direction `dir` (-1 = CCW, +1 = CW). Covers a selected Standoff (its own
  // exclusive selection — rotates the axis 45°), and selected Conduits (45°
  // quantum) / Angle Dial nodes (each node's own `step`). Returns the count
  // rotated so the caller only swallows the key when something happened.
  function rotateSelection(dir: number): number {
    // Standoff selection is standoff-local and mutually exclusive with nodes,
    // so handle it first and on its own. Mirror the inspector dial's onAngle:
    // current axis angle ± 45° → vector → nearest compass anchor.
    const standoffSel = standoffStore.selected();
    if (standoffSel) {
      const s = standoffStore.get(standoffSel);
      if (!s) return 0;
      const d = ANCHOR_DIR[s.a.anchor];
      const cur = (Math.atan2(d.y, d.x) * 180) / Math.PI;
      const rad = ((cur + dir * 45) * Math.PI) / 180;
      standoffStore.setAxis(s.id, anchorFromVector(Math.cos(rad), Math.sin(rad)));
      settleStandoffs();
      scheduleAutosave();
      return 1;
    }
    const editor = editorRef.current;
    if (!editor) return 0;
    let conduits = 0, dials = 0;
    for (const n of editor.getNodes()) {
      if ((n as { selected?: boolean }).selected !== true) continue;
      if (n instanceof ConduitNode) { n.rotateBy(dir); conduits++; }
      else if (n instanceof AngleDialNode) {
        const next = Math.round(n.value + dir * n.step);
        n.value = ((next % 360) + 360) % 360;
        dials++;
      }
    }
    if (conduits) bumpConduitAngle();   // re-renders conduits across React roots
    if (dials) { void processGraph(); scheduleAutosave(); } // recompute + re-render dials, propagate downstream
    return conduits + dials;
  }
  // Move the selected node(s) by (dx, dy) — the arrow-key nudge. Each affected
  // node moves exactly once: the selection plus the members of any selected
  // group (so a group carries its contents like a drag). area.translate is
  // auto-recorded by the history plugin, so the nudge is undoable; merged with
  // a drag's own translate actions. Docked FCs follow their host; standoffs
  // re-settle. Caller checks the selection synchronously to decide preventDefault.
  async function nudgeSelection(dx: number, dy: number) {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    // Build the full move set: a selected GROUP carries its members, and
    // touching any node in a STANDOFF cluster carries the whole cluster, so a
    // standoffed pair moves rigidly (moving only one end and re-settling pulls
    // it half-way back — the bug: a standoffed note/group nudged half as far as
    // a free one). See expandMoveSet.
    const selectedIds = editor.getNodes()
      .filter((n) => (n as { selected?: boolean }).selected === true)
      .map((n) => n.id);
    const toMove = expandMoveSet(editor, selectedIds);
    for (const id of toMove) {
      const v = area.nodeViews.get(id);
      if (!v) continue;
      await area.translate(id, { x: v.position.x + dx, y: v.position.y + dy });
      repositionDockedNodes(id); // a docked FC rides along with its host
    }
    // Whole clusters moved uniformly, so this is a no-op for them; it just
    // tidies any incidental band state.
    if (!standoffStore.isEmpty()) settleStandoffs();
    scheduleAutosave();
  }

  async function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;

    // A heavy recompute is running: the compute overlay blocks pointer input, so
    // block the canvas keyboard shortcuts too (add/group/tidy/undo…) — a queued key
    // must not mutate the graph mid-pass. This listener only drives canvas
    // shortcuts; a focused field's own handlers are untouched.
    if (computeOverlayStore.visible()) return;

    // The Composite drill-in editor is open: the overlay owns the keyboard
    // (its own Delete/Escape handling); canvas shortcuts must not reach the
    // OUTER graph underneath it.
    if (compositeEditorStore.isOpen() && e.key !== "F9") return;

    // Presenter mode: the overlay owns the keyboard (advance/back/Esc on its
    // own window listener). Without this gate the arrow keys ALSO nudge the
    // still-selected Presentation node 24px per slide on the hidden canvas,
    // and every bare-letter/Ctrl shortcut mutates the graph mid-show.
    if (presentationStore.isActive() && e.key !== "F9") return;

    // F9 — Calculate now (Excel). Recomputes + rerolls volatiles in ANY mode; in
    // manual mode it's the only thing that recomputes. Global, even while typing —
    // and even while PRESENTING or DRILLED INTO a composite (the gates above
    // exempt it): both overlays hide/cover the StatusBar chip + MenuBar item, so
    // in manual/sketch mode F9 is the ONLY remaining recompute path there. Only
    // the compute-overlay gate outranks it (never queue a recompute mid-pass).
    if (e.key === "F9") { e.preventDefault(); void requestRecalc(); return; }

    // Single-key canvas shortcuts (no modifier; ignored while typing). Esc
    // exits isolate. The bare letters drive the graph-domain actions so the
    // Ctrl+Shift chords aren't needed; modifier combos fall through below.
    if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Command palette: bare Enter, guarded by the exact same `editable`
      // check every other single-key shortcut uses, so committing a text
      // field with Enter never opens it. Also stays out from under any
      // other modal already open (each of those either focuses an input,
      // which `editable` already covers, or — like Settings' switches — is
      // a non-input control that `editable` wouldn't catch on its own).
      if (
        e.key === "Enter" && !paletteStore.get() && !isAddMenuOpen() &&
        !frStore.get() && !settingsPanel.get() && !shortcutsStore.get()
      ) {
        paletteStore.open(); e.preventDefault(); return;
      }
      if (e.key === "Escape" && isolateStore.isActive()) {
        isolateStore.exit(); e.preventDefault(); return;
      }
      // Arrow keys nudge the selected node(s): one grid cell (24px), Shift =
      // four cells (96px). Handled before the !shiftKey split so Shift just
      // scales the step. Decide preventDefault synchronously (the move is async).
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const editor = editorRef.current;
        const hasSel = !!editor && editor.getNodes().some((n) => (n as { selected?: boolean }).selected === true);
        if (hasSel) {
          const step = e.shiftKey ? DOT_SPACING * 4 : DOT_SPACING;
          const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
          const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
          void nudgeSelection(dx, dy);
          e.preventDefault(); return;
        }
        return; // nothing selected → no nudge, and no other shortcut on an arrow
      }
      if (!e.shiftKey) {
        const editor = editorRef.current;
        const area = areaRef.current;
        // Rotate the selected rotatable thing (Conduit / Angle Dial node /
        // Standoff). Match the produced CHARACTER, not e.code: `[` / `]` sit on
        // different physical keys across keyboard layouts, and the reference
        // shows the character. `[` = CCW, `]` = CW.
        // Tab toggles all collapsible chrome (navigator + pin / alert HUDs) as
        // one group — collapse all if any is open, else expand all. BUT Tab is
        // also the browser's focus-traversal key, so only hijack it when focus
        // is on the canvas BACKGROUND (body) — never when it sits on a control
        // (a node's button / chevron / field, a panel item), where Tab must
        // move between that element's own focusable siblings. `editable` above
        // already let inputs through; this also covers focusable NON-inputs
        // inside a node, which otherwise randomly tabbed out and toggled chrome
        // mid-edit.
        if (e.key === "Tab") {
          const onBackground =
            target == null || target === document.body || target === document.documentElement;
          if (onBackground && toggleAllChrome() > 0) { e.preventDefault(); return; }
          return; // on a control → let native focus traversal happen
        }
        if (e.key === "[" || e.key === "]") {
          if (rotateSelection(e.key === "]" ? 1 : -1) > 0) { e.preventDefault(); return; }
          // nothing rotatable selected → leave the key alone (falls through;
          // the e.code switch below has no bracket case, so it's a no-op).
        }
        switch (e.code) {
          case "KeyI": // Isolate the selection / exit if already isolating
            if (isolateStore.isActive()) isolateStore.exit(); else isolateSelection();
            e.preventDefault(); return;
          case "KeyA": // Add node at the cursor
            addMenuRequest.open(screenMouseRef.current.x, screenMouseRef.current.y);
            e.preventDefault(); return;
          case "KeyG": // Group the selection (no-op if nothing is selected)
            if (editor && area && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
              void createGroupFromSelection(editor, area).then(() => processGraph());
            }
            e.preventDefault(); return;
          case "KeyT": // Tidy / auto-arrange the selection, or all
            void tidyGraph(); e.preventDefault(); return;
          case "KeyC": // Cleanup: tidy groups → collapse → tidy top level → fit
            void cleanupGraph(); e.preventDefault(); return;
          case "KeyE": // Expand / collapse groups
            expandCollapseGroups(); e.preventDefault(); return;
          case "KeyF": // Autofit group box to members
            autofitGroups(); e.preventDefault(); return;
          case "KeyN": // Toggle the Navigator (outline) panel
            toggleChrome("navigator"); e.preventDefault(); return;
          case "BracketLeft":  // Rotate the selected rotatable thing one step CCW
          case "BracketRight": // …or CW (Conduit / Angle Dial node / Standoff)
            if (rotateSelection(e.code === "BracketRight" ? 1 : -1) > 0) {
              e.preventDefault(); return;
            }
            break; // nothing rotatable selected → leave the key alone
        }
      }
    }

    // Ctrl/Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+/ opens function reference, Ctrl+, opens settings (both allowed
      // even when an input is focused). e.key (not e.code) for the slash: it's
      // a punctuation mark that moves around on non-US layouts, unlike the
      // letter-mnemonic shortcuts below which are meant to stay at the same
      // physical position regardless of layout.
      if (e.key === "/") { frStore.toggle(); e.preventDefault(); return; }
      if (e.code === "Comma") { settingsPanel.toggle(); e.preventDefault(); return; }
      // Save / Save As / Open work even while a node field is focused (and must
      // preventDefault to block the browser's own save/open dialogs).
      if (e.code === "KeyS") { void saveToDisk({ forceDialog: e.shiftKey }); e.preventDefault(); return; }
      if (e.code === "KeyO") { void openFromDisk(); e.preventDefault(); return; }
      // Ctrl+Shift+L: genuine reload of the current document (replays the
      // cinematic). A deliberate combo so it can't fire by accident; avoids the
      // browser's own reload keys (Ctrl+R / Ctrl+Shift+R / F5).
      if (e.code === "KeyL" && e.shiftKey) { void documentStore.reloadCurrent(); e.preventDefault(); return; }
      if (editable) return;
      // Ctrl+Shift+G: collapse the selected nodes into a Composite — the
      // computing-subgraph counterpart to bare-G's Group (which just frames
      // a selection). Mirrors createGroupFromSelection's own hotkey guard.
      if (e.code === "KeyG" && e.shiftKey) {
        const editor = editorRef.current;
        const area = areaRef.current;
        if (editor && area && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
          void createCompositeFromSelection(editor, area);
        }
        e.preventDefault(); return;
      }
      // Select all: capture Ctrl/Cmd+A so the browser doesn't select page
      // text — select every node instead (deleting/moving them takes their
      // cables along).
      if (e.code === "KeyA") {
        const editor = editorRef.current;
        if (editor) {
          unselectAllNodesFromProcess();
          cableSelectionStore.set(null);
          editor.getNodes().forEach((n, i) => selectNodeFromProcess(n.id, i > 0));
        }
        e.preventDefault(); return;
      }
      // Copy/paste
      if (e.code === "KeyC") {
        copySelected(); e.preventDefault(); return;
      }
      if (e.code === "KeyV") {
        if (isolateStore.isActive()) { e.preventDefault(); return; } // no new nodes while isolating
        const area = areaRef.current;
        const container = containerRef.current;
        if (area && container) {
          const { x: tx, y: ty, k } = area.area.transform;
          const rect = container.getBoundingClientRect();
          const canvasX = (screenMouseRef.current.x - rect.left - tx) / k;
          const canvasY = (screenMouseRef.current.y - rect.top - ty) / k;
          void pasteClipboard(canvasX, canvasY);
        }
        e.preventDefault(); return;
      }
      // History
      const history = historyRef.current;
      if (!history) return;
      // Gate undo/redo: a single action can restore/remove MANY cables (undoing a
      // bulk delete or a paste), and each would otherwise fire the per-cable settle
      // → O(cables × nodes). withGraphRebuild suppresses that and settles once, but
      // only if topology actually changed (undoing a node move pays nothing).
      if (e.code === "KeyZ" && !e.shiftKey) { void withGraphRebuild(() => history.undo()); e.preventDefault(); return; }
      if (e.code === "KeyZ" &&  e.shiftKey) { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
      if (e.code === "KeyY")                { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
      return;
    }

    // Delete: selected cable first, then selected nodes.
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (editable) return;
    await deleteSelected();
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
