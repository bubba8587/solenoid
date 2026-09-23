// [[B10]] reactFlowView (module-singleton store, storeKit)

import { createNotifier } from "./storeKit";

const REVEAL_DELAY = 150;
const MIN_VISIBLE = 350;

let _depth = 0;
let _visible = false;
let _shownAt = 0;
let _revealTimer: ReturnType<typeof setTimeout> | undefined;
let _hideTimer: ReturnType<typeof setTimeout> | undefined;
const { notify: emit, subscribe } = createNotifier();

export function beginCompute(): void {
  _depth++;
  if (_depth !== 1) return;
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = undefined; }
  if (_visible || _revealTimer) return;
  _revealTimer = setTimeout(() => {
    _revealTimer = undefined;
    if (_depth > 0) { _visible = true; _shownAt = Date.now(); emit(); }
  }, REVEAL_DELAY);
}

export function endCompute(): void {
  _depth = Math.max(0, _depth - 1);
  if (_depth > 0) return;
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = undefined; }
  if (!_visible) return;
  const wait = Math.max(0, MIN_VISIBLE - (Date.now() - _shownAt));
  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    _hideTimer = undefined;
    if (_depth === 0) { _visible = false; emit(); }
  }, wait);
}

export const computeOverlayStore = {
  visible: (): boolean => _visible,
  subscribe,
};
