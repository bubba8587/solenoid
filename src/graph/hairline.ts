// The card frame's strokes are drawn in canvas user space, so the camera scale
// and the display's device-pixel ratio both shrink them: a 1px border lands on
// `k * devicePixelRatio` device pixels. Below 1 that is less than a whole pixel of
// ink, and where the card's far edge falls mid-pixel the rasterizer splits what
// little there is across two rows and the edge reads as missing — measured as the
// bottom border dropping to a third of the left one's contrast on a dpr-1 display
// at k≈0.42 (6 of 27 cards), while dpr 2 and 3 stay clean at the same zoom. That
// is why it shows on a desktop monitor at 100% scaling and not on a phone.
//
// So the width is floored at one device pixel. At dpr 1 and 100% zoom the var is
// exactly 1px and every frame expression reduces to the literal it replaced, so
// the card is unchanged there; below that the stroke widens in user space to hold
// a hairline on screen.
//
// Published as a ready-made length, not the raw scale, so the CSS stays a plain
// var(): writing a custom property costs a document-wide style recalc, and doing
// it every zoom frame nearly doubled frame cost (11.8ms vs 6.3ms across 28 cards).
// Quantizing and throttling keeps it to a few writes per gesture; a stroke one
// step stale mid-zoom is invisible, so the trailing write is what has to land.

const QUANTUM = 4; // 1/4 px steps — finer than the eye can read on a hairline
const MIN_INTERVAL_MS = 120;

let _published = "";
let _pendingK: number | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _lastWrite = 0;

/** Stroke width, in CSS px, that renders as at least one device pixel. */
export function hairlineFor(k: number, dpr: number): number {
  const scale = k * (dpr > 0 ? dpr : 1);
  if (!(scale > 0)) return 1;
  return Math.max(1, Math.round((1 / scale) * QUANTUM) / QUANTUM);
}

function flush(): void {
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
  }
  _lastWrite = Date.now();
  if (_pendingK === null) return;
  const next = `${hairlineFor(_pendingK, window.devicePixelRatio)}px`;
  _pendingK = null;
  if (next === _published) return;
  _published = next;
  document.documentElement.style.setProperty("--frame-hairline", next);
}

/** Republish `--frame-hairline` for the current camera scale. Called wherever the
 *  camera reaches the DOM; safe to call every frame. */
export function syncHairlineFor(k: number): void {
  if (typeof document === "undefined") return; // node/test env
  _pendingK = k;
  const wait = MIN_INTERVAL_MS - (Date.now() - _lastWrite);
  if (wait <= 0) flush();
  else if (_timer === null) _timer = setTimeout(flush, wait);
}
