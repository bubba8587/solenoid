// [[B10]] reactFlowView, [[C43]] oneFlowSurface

let _unselectAllNodes: () => void = () => {};

export function setUnselectAllNodes(fn: () => void) {
  _unselectAllNodes = fn;
}

export function unselectAllNodes() {
  _unselectAllNodes();
}

let _autoArrange: (opts?: { groupId?: string }) => Promise<void> = async () => {};

export function setAutoArrange(fn: (opts?: { groupId?: string }) => Promise<void>) {
  _autoArrange = fn;
}

export function autoArrange(opts?: { groupId?: string; skipConfirm?: boolean }) {
  return _autoArrange(opts);
}

let _cleanup: () => Promise<void> = async () => {};

export function setCleanup(fn: () => Promise<void>) {
  _cleanup = fn;
}

export function cleanup() {
  return _cleanup();
}

let _deleteSelected: () => Promise<void> = async () => {};

export function setDeleteSelected(fn: () => Promise<void>) {
  _deleteSelected = fn;
}

export function deleteSelected() {
  return _deleteSelected();
}

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

export function swapRepositionDockedSlot(fn: (hostId: string) => void): () => void {
  const prev = _repositionDocked;
  _repositionDocked = fn;
  return () => { _repositionDocked = prev; };
}

export function swapDeleteSlot(fn: () => Promise<void>): () => void {
  const prev = _deleteSelected;
  _deleteSelected = fn;
  return () => { _deleteSelected = prev; };
}

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

// Must run after every document load or rebuild, or Ctrl+Z unwinds the load itself.
let _clearHistory: () => void = () => {};

export function setClearHistory(fn: () => void) {
  _clearHistory = fn;
}

export function clearHistory() {
  _clearHistory();
}

