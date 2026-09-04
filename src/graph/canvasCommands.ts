// The chrome → surface command slots. Menus, the palette, keyboard and touch bars
// call these verbs; whichever FlowSurface is mounted registers the implementation,
// and the composite drill-in swaps the selection / arrange slots while it is open
// (decisions oneFlowSurface). Compute lives in process.ts; this is only routing.

// Node and cable selections are mutually exclusive.
let _unselectAllNodes: () => void = () => {};

export function setUnselectAllNodes(fn: () => void) {
  _unselectAllNodes = fn;
}

export function unselectAllNodes() {
  _unselectAllNodes();
}

// `autoArrange({ groupId })` lays out just that group's members.
let _autoArrange: (opts?: { groupId?: string }) => Promise<void> = async () => {};

export function setAutoArrange(fn: (opts?: { groupId?: string }) => Promise<void>) {
  _autoArrange = fn;
}

export function autoArrange(opts?: { groupId?: string; skipConfirm?: boolean }) {
  return _autoArrange(opts);
}

// One-shot graph cleanup: tidy groups, collapse them, tidy the top level, fit view.
let _cleanup: () => Promise<void> = async () => {};

export function setCleanup(fn: () => Promise<void>) {
  _cleanup = fn;
}

export function cleanup() {
  return _cleanup();
}

// The same path Delete/Backspace takes, so keyboard-less chrome deletes identically.
let _deleteSelected: () => Promise<void> = async () => {};

export function setDeleteSelected(fn: () => Promise<void>) {
  _deleteSelected = fn;
}

export function deleteSelected() {
  return _deleteSelected();
}

// Called when a host node resizes so docked Format Controllers follow their socket.
let _repositionDocked: (hostId: string) => void = () => {};

export function setRepositionDocked(fn: (hostId: string) => void) {
  _repositionDocked = fn;
}

export function repositionDockedNodes(hostId: string) {
  _repositionDocked(hostId);
}

let _selectNode: (id: string, accumulate: boolean) => void = () => {};

export function setSelectNode(fn: (id: string, accumulate: boolean) => void) {
  _selectNode = fn;
}

export function selectNode(id: string, accumulate: boolean) {
  _selectNode(id, accumulate);
}

/** Point Tidy / Cleanup at a substitute surface (the composite drill-in) while it is
 *  open; the returned restorer hands them back. */
export function swapArrangeSlots(fns: { autoArrange: (opts?: { groupId?: string }) => Promise<void>; cleanup: () => Promise<void> }): () => void {
  const prevArrange = _autoArrange;
  const prevCleanup = _cleanup;
  _autoArrange = fns.autoArrange;
  _cleanup = fns.cleanup;
  return () => {
    _autoArrange = prevArrange;
    _cleanup = prevCleanup;
  };
}

/** Point the delete verb (the keyboard-less mobile / tablet delete button) at a substitute
 *  surface (the composite drill-in) while it is open; the returned restorer hands it back.
 *  The Delete KEY is already per-surface through RF's onBeforeDelete — this covers the chrome
 *  button that goes through the slot instead. */
export function swapDeleteSlot(fn: () => Promise<void>): () => void {
  const prev = _deleteSelected;
  _deleteSelected = fn;
  return () => { _deleteSelected = prev; };
}

/** Point the selection verbs at a substitute surface (the composite drill-in) while it is
 *  open; the returned restorer hands them back to the main canvas. */
export function swapSelectionSlots(fns: {
  selectNode: (id: string, accumulate: boolean) => void;
  unselectAllNodes: () => void;
}): () => void {
  const prevSelect = _selectNode;
  const prevUnselect = _unselectAllNodes;
  _selectNode = fns.selectNode;
  _unselectAllNodes = fns.unselectAllNodes;
  return () => {
    _selectNode = prevSelect;
    _unselectAllNodes = prevUnselect;
  };
}

// MUST be called after every document load/rebuild, or Ctrl+Z unwinds the LOAD itself.
let _clearHistory: () => void = () => {};

export function setClearHistory(fn: () => void) {
  _clearHistory = fn;
}

export function clearHistory() {
  _clearHistory();
}

