// Canvas keyboard shortcuts, skipped while focus is in an editable form element.
import type { Area } from "./area";
import type { MutableRefObject } from "react";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
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
import { groupCollapseStore } from "./groupCollapse";
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
  areaRef: MutableRefObject<Area | null>;
  historyRef: MutableRefObject<{ undo(): Promise<unknown>; redo(): Promise<unknown> } | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  screenMouseRef: MutableRefObject<{ x: number; y: number }>;
  /** Live "is the Add/quick-wire menu open" check for the bare-Enter palette guard. */
  isAddMenuOpen: () => boolean;
  /** The MAIN canvas stands down while the composite drill-in owns the keyboard
   *  (the drill-in installs its own instance over its refs). */
  standsDownWhenDrilled?: boolean;
}

export function installCanvasKeyboard(deps: CanvasKeyboardDeps): () => void {
  const { editorRef, areaRef, historyRef, containerRef, screenMouseRef, isAddMenuOpen, standsDownWhenDrilled } = deps;

  // Selected groups + the group of any selected member; all groups when none.
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
    const collapse = targets.some((g) => !g.collapsed);
    void setGroupsCollapsed(editor, area, targets, collapse).then(() => scheduleAutosave());
  }
  function autofitGroups() {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    const targets = resolveGroupTargets();
    void (async () => { for (const g of targets) await autofitGroupWithHistory(editor, area, g); })();
  }
  // Rotate the selected Standoff / Conduits / Angle Dials one step (-1 = CCW).
  // Returns the count rotated so the caller only swallows the key on a hit.
  function rotateSelection(dir: number): number {
    // Standoff selection is mutually exclusive with node selection, so it goes
    // first and on its own.
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
    if (dials) { void processGraph(); scheduleAutosave(); }
    return conduits + dials;
  }
  // The arrow-key nudge: each affected node moves exactly ONCE. The caller must
  // check the selection synchronously to decide preventDefault (this is async).
  async function nudgeSelection(dx: number, dy: number) {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    // A standoff cluster moves as a whole — nudging one end and re-settling would
    // pull it half-way back.
    const selectedIds = editor.getNodes()
      .filter((n) => (n as { selected?: boolean }).selected === true)
      .map((n) => n.id);
    const toMove = expandMoveSet(editor, selectedIds);
    for (const id of toMove) {
      const v = area.nodeViews.get(id);
      if (!v) continue;
      await area.moveNode(id, { x: v.position.x + dx, y: v.position.y + dy });
      repositionDockedNodes(id); // a docked FC rides along with its host
    }
    if (!standoffStore.isEmpty()) settleStandoffs();
    scheduleAutosave();
  }

  async function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;

    // The compute overlay blocks pointer input; block the keyboard too, so a queued
    // key can't mutate the graph mid-pass.
    if (computeOverlayStore.visible()) return;

    // The drill-in overlay owns the keyboard — shortcuts must not reach the OUTER
    // graph underneath it.
    if (standsDownWhenDrilled && compositeEditorStore.isOpen() && e.key !== "F9") return;

    // Presenter mode owns the keyboard; without this gate the arrow keys also nudge
    // the still-selected node on the hidden canvas.
    if (presentationStore.isActive() && e.key !== "F9") return;

    // F9 stays live while typing, presenting and drilled in — under those overlays
    // it is the only remaining recompute path. Only the compute gate outranks it.
    if (e.key === "F9") { e.preventDefault(); void requestRecalc(); return; }

    if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Bare Enter opens the palette — gated on `editable` so committing a field
      // never opens it, and on every other modal that `editable` wouldn't catch.
      if (
        e.key === "Enter" && !paletteStore.get() && !isAddMenuOpen() &&
        !frStore.get() && !settingsPanel.get() && !shortcutsStore.get()
      ) {
        paletteStore.open(); e.preventDefault(); return;
      }
      if (e.key === "Escape" && isolateStore.isActive()) {
        isolateStore.exit(); e.preventDefault(); return;
      }
      // Handled before the !shiftKey split so Shift just scales the nudge step.
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
        // Tab is also the browser's focus-traversal key, so only hijack it on the
        // canvas BACKGROUND — on a control, native traversal must win.
        if (e.key === "Tab") {
          const onBackground =
            target == null || target === document.body || target === document.documentElement;
          if (onBackground && toggleAllChrome() > 0) { e.preventDefault(); return; }
          return;
        }
        // Match the produced CHARACTER: `[` / `]` sit on different physical keys
        // across layouts, and the reference shows the character.
        if (e.key === "[" || e.key === "]") {
          if (rotateSelection(e.key === "]" ? 1 : -1) > 0) { e.preventDefault(); return; }
        }
        switch (e.code) {
          case "KeyI":
            if (isolateStore.isActive()) isolateStore.exit(); else isolateSelection();
            e.preventDefault(); return;
          case "KeyA":
            addMenuRequest.open(screenMouseRef.current.x, screenMouseRef.current.y);
            e.preventDefault(); return;
          case "KeyG":
            if (editor && area && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
              void createGroupFromSelection(editor, area).then(() => processGraph());
            }
            e.preventDefault(); return;
          case "KeyT":
            void tidyGraph(); e.preventDefault(); return;
          case "KeyC":
            void cleanupGraph(); e.preventDefault(); return;
          case "KeyE":
            expandCollapseGroups(); e.preventDefault(); return;
          case "KeyF":
            autofitGroups(); e.preventDefault(); return;
          case "KeyN":
            toggleChrome("navigator"); e.preventDefault(); return;
          case "BracketLeft":
          case "BracketRight":
            if (rotateSelection(e.code === "BracketRight" ? 1 : -1) > 0) {
              e.preventDefault(); return;
            }
            break;
        }
      }
    }

    if (e.ctrlKey || e.metaKey) {
      // e.key for the slash — punctuation moves around on non-US layouts, unlike the
      // letter mnemonics below, which are meant to stay at a fixed physical key.
      if (e.key === "/") { frStore.toggle(); e.preventDefault(); return; }
      if (e.code === "Comma") { settingsPanel.toggle(); e.preventDefault(); return; }
      // Live even while a node field is focused; preventDefault blocks the browser's
      // own save/open dialogs.
      if (e.code === "KeyS") { void saveToDisk({ forceDialog: e.shiftKey }); e.preventDefault(); return; }
      if (e.code === "KeyO") { void openFromDisk(); e.preventDefault(); return; }
      // A deliberate combo that avoids the browser's own reload keys.
      if (e.code === "KeyL" && e.shiftKey) { void documentStore.reloadCurrent(); e.preventDefault(); return; }
      if (editable) return;
      if (e.code === "KeyG" && e.shiftKey) {
        const editor = editorRef.current;
        const area = areaRef.current;
        if (editor && area && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
          void createCompositeFromSelection(editor, area);
        }
        e.preventDefault(); return;
      }
      if (e.code === "KeyA") {
        const editor = editorRef.current;
        if (editor) {
          unselectAllNodesFromProcess();
          cableSelectionStore.set(null);
          // "All" = only what the user can SEE and act on (the lasso's rule):
          // collapsed-group members and isolate's receded nodes are skipped.
          const selectable = editor.getNodes().filter(
            (n) => !groupCollapseStore.isNodeHidden(n.id) && isolateStore.isVisible(n.id),
          );
          selectable.forEach((n, i) => selectNodeFromProcess(n.id, i > 0));
        }
        e.preventDefault(); return;
      }
      if (e.code === "KeyC") {
        copySelected(); e.preventDefault(); return;
      }
      if (e.code === "KeyV") {
        if (isolateStore.isActive()) { e.preventDefault(); return; } // no new nodes while isolating
        const area = areaRef.current;
        const container = containerRef.current;
        if (area && container) {
          const { x: tx, y: ty, k } = area.transform;
          const rect = container.getBoundingClientRect();
          const canvasX = (screenMouseRef.current.x - rect.left - tx) / k;
          const canvasY = (screenMouseRef.current.y - rect.top - ty) / k;
          void pasteClipboard(canvasX, canvasY);
        }
        e.preventDefault(); return;
      }
      const history = historyRef.current;
      if (!history) return;
      // One undo can restore MANY cables, each otherwise firing the per-cable settle
      // → O(cables × nodes); withGraphRebuild settles once instead.
      if (e.code === "KeyZ" && !e.shiftKey) { void withGraphRebuild(() => history.undo()); e.preventDefault(); return; }
      if (e.code === "KeyZ" &&  e.shiftKey) { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
      if (e.code === "KeyY")                { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
      return;
    }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
