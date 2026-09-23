// [[C43]] oneFlowSurface (installed by the surface, once), [[C52]] visibleSelection
import type { View } from "./view";
import type { MutableRefObject } from "react";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { processGraph, requestRecalc, withGraphRebuild, notifyGraphChanged } from "./process";
import { repositionDockedNodes, unselectAllNodes as unselectAllNodesFromProcess, selectNode as selectNodeFromProcess, cleanup as cleanupGraph, autoArrange as tidyGraph, deleteSelected } from "./canvasCommands";
import { bumpConduitAngle } from "./graphSignals";
import { copySelected, pasteClipboard } from "./copyPaste";
import { createCompositeFromSelection } from "./compositeLogic";
import { compositeEditorStore } from "./compositeEditorStore";
import { presentationStore } from "./presentationStore";
import { paletteStore } from "./paletteStore";
import { frStore } from "./frStore";
import { settingsPanel } from "./settingsStore";
import { keyUnderModal } from "./modalGuard";
import { cableSelectionStore } from "./cableState";
import { ConduitNode, AngleDialNode, GroupNode } from "./rete-nodes";
import { toggleAllChrome, toggleChrome } from "./chromeToggle";
import { createGroupFromSelection, autofitGroupWithHistory } from "./groupLogic";
import { setGroupsCollapsed } from "./groupPush";
import { groupCollapseStore } from "./groupCollapse";
import { standoffStore, settleStandoffs, anchorFromVector, ANCHOR_DIR } from "./standoffs";
import { drawModeStore, drawnCableStore, finishDrawing } from "./drawnCables";
import { isolateStore } from "./isolateStore";
import { isolateSelection } from "./isolate";
import { addMenuRequest } from "./addMenuStore";
import { expandMoveSet } from "./selectionOps";
import { scheduleAutosave } from "./persistence";
import { saveToDisk, openFromDisk } from "./fileSession";
import { DOT_SPACING } from "./gridSnapStore";
import { canvasLockStore } from "./canvasLock";
import { computeOverlayStore } from "./computeOverlayStore";
import { documentStore } from "./documentStore";

export interface CanvasKeyboardDeps {
  editorRef: MutableRefObject<NodeEditor<Schemes> | null>;
  viewRef: MutableRefObject<View | null>;
  historyRef: MutableRefObject<{ undo(): Promise<unknown>; redo(): Promise<unknown> } | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  screenMouseRef: MutableRefObject<{ x: number; y: number }>;
  isAddMenuOpen: () => boolean;
  standsDownWhenDrilled?: boolean;
}

export function installCanvasKeyboard(deps: CanvasKeyboardDeps): () => void {
  const { editorRef, viewRef, historyRef, containerRef, screenMouseRef, isAddMenuOpen, standsDownWhenDrilled } = deps;

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
    const view = viewRef.current;
    if (!editor || !view) return;
    const targets = resolveGroupTargets();
    if (targets.length === 0) return;
    const collapse = targets.some((g) => !g.collapsed);
    void setGroupsCollapsed(editor, view, targets, collapse).then(() => scheduleAutosave());
  }
  function autofitGroups() {
    const editor = editorRef.current;
    const view = viewRef.current;
    if (!editor || !view) return;
    const targets = resolveGroupTargets();
    void (async () => { for (const g of targets) await autofitGroupWithHistory(editor, view, g); })();
  }
  function rotateSelection(dir: number): number {
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
    if (conduits) { bumpConduitAngle(); notifyGraphChanged(); }
    if (dials) { void processGraph(); scheduleAutosave(); }
    return conduits + dials;
  }
  // Async, so the caller checks the selection synchronously to decide preventDefault.
  async function nudgeSelection(dx: number, dy: number) {
    const editor = editorRef.current;
    const view = viewRef.current;
    if (!editor || !view) return;
    const selectedIds = editor.getNodes()
      .filter((n) => (n as { selected?: boolean }).selected === true)
      .map((n) => n.id);
    const toMove = expandMoveSet(editor, selectedIds);
    for (const id of toMove) {
      const pos = view.position(id);
      if (!pos) continue;
      await view.moveNode(id, { x: pos.x + dx, y: pos.y + dy });
      repositionDockedNodes(id);
    }
    if (!standoffStore.isEmpty()) settleStandoffs();
    scheduleAutosave();
  }

  async function onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;

    if (computeOverlayStore.visible()) return;

    if (standsDownWhenDrilled && compositeEditorStore.isOpen() && e.key !== "F9") return;

    if (presentationStore.isActive() && e.key !== "F9") return;

    if (keyUnderModal(e) && e.key !== "F9") return;

    if (target?.closest?.(".nokeys") && e.key !== "F9") return;

    if (e.key === "F9") { e.preventDefault(); void requestRecalc(); return; }

    if (drawModeStore.armed() && !editable && !e.ctrlKey && !e.metaKey) {
      if (e.key === "Escape") { drawModeStore.disarm(); e.preventDefault(); return; }
      if (e.key === "Enter") { finishDrawing(); e.preventDefault(); return; }
      if (e.key === "Backspace") { drawModeStore.undoPoint(); e.preventDefault(); return; }
    }

    const locked = canvasLockStore.get();
    if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if ((e.key === "Delete" || e.key === "Backspace") && (drawnCableStore.selected() || standoffStore.selected())) {
        if (!locked) void deleteSelected();
        e.preventDefault(); return;
      }
      if (e.key === "Enter" && !isAddMenuOpen()) {
        paletteStore.open(); e.preventDefault(); return;
      }
      if (e.key === "Escape" && isolateStore.isActive()) {
        isolateStore.exit(); e.preventDefault(); return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const editor = editorRef.current;
        const hasSel = !!editor && editor.getNodes().some((n) => (n as { selected?: boolean }).selected === true);
        if (hasSel && !locked) {
          const step = e.shiftKey ? DOT_SPACING * 4 : DOT_SPACING;
          const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
          const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
          void nudgeSelection(dx, dy);
          e.preventDefault(); return;
        }
        return;
      }
      if (!e.shiftKey) {
        const editor = editorRef.current;
        const view = viewRef.current;
        if (e.key === "Tab") {
          const onBackground =
            target == null || target === document.body || target === document.documentElement;
          if (onBackground && toggleAllChrome() > 0) { e.preventDefault(); return; }
          return;
        }
        // Match the produced character: `[` and `]` sit on different physical keys across layouts.
        if ((e.key === "[" || e.key === "]") && !locked) {
          if (rotateSelection(e.key === "]" ? 1 : -1) > 0) { e.preventDefault(); return; }
        }
        switch (e.code) {
          case "KeyI":
            if (isolateStore.isActive()) isolateStore.exit(); else isolateSelection();
            e.preventDefault(); return;
          case "KeyA":
            if (!locked) addMenuRequest.open(screenMouseRef.current.x, screenMouseRef.current.y);
            e.preventDefault(); return;
          case "KeyG":
            if (!locked && editor && view && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
              void createGroupFromSelection(editor, view).then(() => processGraph());
            }
            e.preventDefault(); return;
          case "KeyT":
            if (!locked) void tidyGraph();
            e.preventDefault(); return;
          case "KeyC":
            if (!locked) void cleanupGraph();
            e.preventDefault(); return;
          case "KeyE":
            if (!locked) expandCollapseGroups();
            e.preventDefault(); return;
          case "KeyF":
            if (!locked) autofitGroups();
            e.preventDefault(); return;
          case "KeyN":
            toggleChrome("navigator"); e.preventDefault(); return;
          case "BracketLeft":
          case "BracketRight":
            if (!locked && rotateSelection(e.code === "BracketRight" ? 1 : -1) > 0) {
              e.preventDefault(); return;
            }
            break;
        }
      }
    }

    if (e.ctrlKey || e.metaKey) {
      // e.key for the slash, because punctuation moves on non-US layouts; the letters below stay at fixed physical keys.
      if (e.key === "/") { frStore.toggle(); e.preventDefault(); return; }
      if (e.code === "Comma") { settingsPanel.toggle(); e.preventDefault(); return; }
      if (e.code === "KeyS") { void saveToDisk({ forceDialog: e.shiftKey }); e.preventDefault(); return; }
      if (e.code === "KeyO") { void openFromDisk(); e.preventDefault(); return; }
      if (e.code === "KeyL" && e.shiftKey) { void documentStore.reloadCurrent(); e.preventDefault(); return; }
      if (editable) return;
      if (e.code === "KeyG" && e.shiftKey) {
        const editor = editorRef.current;
        const view = viewRef.current;
        if (!locked && editor && view && editor.getNodes().some((n) => (n as { selected?: boolean }).selected)) {
          void createCompositeFromSelection(editor, view);
        }
        e.preventDefault(); return;
      }
      if (e.code === "KeyA") {
        const editor = editorRef.current;
        if (editor) {
          unselectAllNodesFromProcess();
          cableSelectionStore.set(null);
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
        if (isolateStore.isActive() || locked) { e.preventDefault(); return; }
        const view = viewRef.current;
        const container = containerRef.current;
        if (view && container) {
          const { x: tx, y: ty, k } = view.transform;
          const rect = container.getBoundingClientRect();
          const canvasX = (screenMouseRef.current.x - rect.left - tx) / k;
          const canvasY = (screenMouseRef.current.y - rect.top - ty) / k;
          void pasteClipboard(canvasX, canvasY);
        }
        e.preventDefault(); return;
      }
      const history = historyRef.current;
      if (!history || locked) return;
      // withGraphRebuild settles once instead of once per restored cable.
      if (e.code === "KeyZ" && !e.shiftKey) { void withGraphRebuild(() => history.undo()); e.preventDefault(); return; }
      if (e.code === "KeyZ" &&  e.shiftKey) { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
      if (e.code === "KeyY")                { void withGraphRebuild(() => history.redo()); e.preventDefault(); return; }
      return;
    }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
