// The "Computing…" curtain BLOCKS interaction, so a multi-second pass can't interleave
// with a pan/drag/add. Deferred past REVEAL_DELAY, then held for MIN_VISIBLE.

import { createNotifier } from "./storeKit";

const REVEAL_DELAY = 150; // ms a pass must run before the curtain appears
const MIN_VISIBLE = 350;  // ms the curtain stays once shown (anti-flash)

let _depth = 0; // in-flight heavy passes
let _visible = false;
let _shownAt = 0;
let _revealTimer: ReturnType<typeof setTimeout> | undefined;
let _hideTimer: ReturnType<typeof setTimeout> | undefined;
const { notify: emit, subscribe } = createNotifier();

/** Schedules the deferred reveal on the first concurrent pass. */
export function beginCompute(): void {
  _depth++;
  if (_depth !== 1) return;
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = undefined; } // a fresh pass cancels a pending hide
  if (_visible || _revealTimer) return;
  _revealTimer = setTimeout(() => {
    _revealTimer = undefined;
    if (_depth > 0) { _visible = true; _shownAt = Date.now(); emit(); }
  }, REVEAL_DELAY);
}

/** When the last pass settles: cancel a not-yet-shown reveal, else hide after the
 *  minimum on-screen time. */
export function endCompute(): void {
  _depth = Math.max(0, _depth - 1);
  if (_depth > 0) return;
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = undefined; } // finished before reveal
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
