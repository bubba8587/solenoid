# Touch & pointer gestures — the input inventory

**THE normative list of what every pointer gesture means, per device config.** Born
2026-08-06 after two phantom-gesture incidents in one session: `layout-chrome.md`
claimed a "canvas double-tap add" that never existed, and the real long-press-to-add
went unrecorded because it rides the browser's native long-press → `contextmenu`
synthesis with no greppable "longpress" anywhere. A gesture that exists only as an
event-plumbing side effect is invisible to search; this file is where every gesture
is written down. **Adding, removing, or regating a gesture updates this file in the
same change.** Deep mechanics stay in `subsystem-invariants.md` § Pointer gestures;
this is the WHAT/WHERE map.

## Device configs (`coarse.ts` — derive, never duplicate)

| Flag | Definition | Interaction model |
|---|---|---|
| `IS_COARSE` | `(pointer: coarse)` matches | touch-primary: bigger hit areas, touch actions in a bar |
| `IS_MOBILE` | `IS_COARSE` AND mobile UA (mirrored to `html.is-mobile` by `main.tsx`) | mobile model: selection-gated nodes, bottom action bar |
| `IS_TABLET` | `IS_COARSE` AND NOT mobile UA | DESKTOP interaction model + touch actions in the top bar |

"Request desktop site" flips the UA test — that is the user's opt-out lever from the
mobile model; never gate on coarseness alone what must flip with it.

## The standing invariants (violations break gestures silently)

- **Pinch listens in CAPTURE, pan/drag in BUBBLE.** `pointerGesture.ts` counts
  contacts from window-capture listeners so no component `stopPropagation` can hide
  a finger; `isPinching()` (≥2 FINGERS — mouse/pen never count) is the ONLY
  definition. Never count raw pointers. Never move pan/drag to capture (they are
  deliberately vetoable). Pinned by `pointerGesture.test.ts`.
- **No palm rejection**, by author call — a precise editor, nobody rests a palm on
  a node graph. A resting stylus is deliberately not half a pinch.
- **A finger never selects on pointerdown** — selection lands via the tap's click (a
  press can become a pan or a pinch; a pinch's click is swallowed by `flowPinch`'s
  click guard). A one-finger drag on an UNSELECTED node PANS (`flowTouchPan.ts`).
- **Mobile selection gating** (`socket.css`, gated `html.is-mobile`): an UNSELECTED
  node/conduit/group/note makes every descendant inert (pan/pinch win); the card
  itself stays tappable (that tap selects). Exceptions: the resize grip is always
  live; every socket is live while a cable drags (`--cabling`).
- **Double-click never zooms** — both surfaces pass `zoomOnDoubleClick={false}`.
  Cable double-click is detected via the click's `detail` count in `onClick`
  (`FlowCableEdge.tsx`), so the guard runs before the single-click select toggle. A
  new "double-tap X" feature is a design smell here; prefer tap or long-press.
- **`stopDragStart`** (`coarse.ts`): read-only node chrome and single-line fields
  swallow pointerdown on desktop (no accidental node drag) but bubble on mobile (a
  pan may start over them). Not for drag-interactive controls or textareas — those
  keep a hard stop.
- **A cable drag blurs the focused field first** (`onConnectStart` in FlowSurface) —
  a mid-edit value commits before it is wired.

## Gesture inventory

### Canvas (empty space)

| Gesture | Config | Action | Where |
|---|---|---|---|
| 1-finger / left-mouse drag | all | pan | RF pane drag (bubble, vetoable); on an unselected card `flowTouchPan.ts` |
| 2-finger pinch | touch | zoom (capped) | `flowPinch.ts` (wrapper capture), `pointerGesture.ts` |
| wheel / ctrl+wheel trackpad pinch | mouse | zoom (proportional, step-capped) | `flowWheel.ts` + `wheelZoomDelta` (`viewPresets.ts`) |
| tap / click | all | clear cable/standoff/endpoint selection | `FlowSurface.tsx` `onPaneClick` |
| **long-press** (touch) / right-click | all | **context menu routing: empty canvas → ADD MENU**; socket → socket menu (≤11px snap radius); cable → cable menu; node → node menu (headed by the node's catalog one-liner — the header tooltip's touch-reachable home). Two regates: suppressed entirely while ISOLATE is active, and the handler bails on the focused editable (the browser's own menu wins there) | `canvasContextMenu.ts` — ONE native `contextmenu` handler; touch long-press is the browser's own synthesis, there is no timer in our code |
| double-tap / double-click | all | **nothing, by design** (`zoomOnDoubleClick={false}` — see invariants) | RF props |

(Marquee/lasso selection exists but its trigger is not recorded here yet — verify in
`canvasLasso.ts`/`touchSelectStore` before citing it anywhere.)

Other add paths (not gestures): mobile bar ➕ FAB, the `A` key, Insert ▸ Add node….

### Nodes

| Gesture | Config | Action | Where |
|---|---|---|---|
| tap (up, ≤slop) | touch | select (via the tap's click — see invariants) | RF click selection + `flowTouchPan.ts` |
| drag on card | mouse; touch only when SELECTED | move node (whole selection if member) | RF node drag (d3, bubble) |
| stationary tap on header label (≤4px `HEADER_TAP_SLOP`) | all | edit title | `nodeKit.tsx` |
| tap chevron (≤slop; drag passes through to node drag) | all | collapse/expand | `NodeCard.tsx` |
| re-expand a square-collapsed Sparkline | all | the chevron, revealed on hover OR SELECTION (touch: tap selects → chevron appears → tap it); `NodeCard`'s `onDoubleClick` fallback also fires for mouse | `nodeCard.css` square-collapse rules |
| drag resize grip | all (live even unselected on mobile) | resize | `ResizeHandle` |

### Sockets & cables

| Gesture | Config | Action | Where |
|---|---|---|---|
| drag from socket | all (mobile: selected node, or any during `--cabling`) | pick/drop cable | RF Handle drag (`FlowSocketHandle`, `onConnect` in FlowSurface) |
| hover dot (300ms intent) | mouse | frame-input EXAMPLE hint (unwired frame input only) | `NodeSocket.tsx` + `frameHint.ts` |
| hover dot (400ms intent) | mouse | VALUE peek — an output socket or a wired input pops the socket's live value as a scaled-down Display beside it (`SocketValuePeek`, the frameHint layer's second payload kind); leave / wheel / cable-pick hides it. Never both with the example hint. Desktop pointer only (touch has no hover). | `NodeSocket.tsx` + `frameHint.ts` + `FrameHintLayer.tsx` |
| tap the input ROW | touch | frame-input EXAMPLE hint — the INTENTIONAL touch trigger; next tap or 4s dismisses. The dot itself deliberately has none: a touch press on the dot begins the cable pick, which captures the pointer (the tap's up never reaches the dot), and the dot scales with the canvas transform anyway (a few px at overview zoom). | `MeasuredSocketRow` / `FrameHintLayer` |
| long-press socket | touch | socket context menu | `canvasContextMenu.ts` |
| touch hit areas | coarse | dot targets inflate to ~28px (Conduit sockets deliberately small so its body stays grabbable); every socket grows further while cabling (coarse −8px → −14px inset; a specificity bug once SHRANK it, fixed 2026-08-09) | `socket.css` |
| click cable / tap | all | select cable (ribbons select the run) | `flow/FlowCableEdge.tsx` |
| double-click cable | mouse | select the whole RUN (via click `detail` count, NOT onDoubleClick) | `flow/FlowCableEdge.tsx` |

### Drawn cables — the armed draw tool (`components/DrawnCableCapture.tsx`)

The tool is MODAL: while armed a full-window sheet sits over the pane, so these replace the
canvas gestures above until it is disarmed. It owns pan itself — the sheet is a SIBLING of
the pane, so declining to swallow a press hands the drag to nobody.

| Gesture | Config | Action | Where |
|---|---|---|---|
| tap / click | all | place a point (only inside `TAP_SLOP`; a longer press was a pan) | `DrawnCableCapture.tsx` |
| 1-finger / left-mouse drag | all | pan the camera, place nothing | `DrawnCableCapture.tsx` `panBy` |
| 2-finger pinch | touch | zoom, place nothing — `flowPinch` listens in CAPTURE so it sees the fingers THROUGH the sheet, and its click guard eats the trailing click; placement also stands down on `isPinching()` | `flowPinch.ts` |
| double-click | **mouse only** | finish the run (click `detail`; click 1 places the last point) | `DrawnCableCapture.tsx` |
| right-click | mouse | finish the run (it raises no click, so it is handled on pointerdown) | `DrawnCableCapture.tsx` |
| Undo / Finish / Done buttons | coarse | the touch way out — double-tap is NOT the finish gesture here, and there is no Esc | the hint strip, at the THUMB end |
| tap/click a point handle | all | make it the angle dial's active point, or drag it | `DrawnCableLayer.tsx` |
| alt-click a handle | mouse | remove that point (the panel's ✕ is the finger's version) | `DrawnCableLayer.tsx` / `DrawnCableInspector.tsx` |
| double-click the cable body | mouse | insert a point on the nearest span | `DrawnCableLayer.tsx` |
| touch hit areas | coarse | hit band 40px, and each handle gets an invisible ~44px ring BEHIND its disc rather than a fatter disc; pending markers stay small (nothing grabs them) | `DrawnCableLayer.tsx` |

### Chrome (bars, popups)

| Gesture | Config | Action | Where |
|---|---|---|---|
| touch action buttons | mobile: bottom bar; tablet: top bar | palette/undo/redo/select/group/delete (+ mobile ➕ and the draw-mode toggle — the top bar's Cable group is `display:none` on mobile) | `touchActions.tsx` (drift-pinned by `touchActions.test.ts`) |
| taps in popups/overlays | all | normal UI; `stopDragStart` guards chrome that sits over the canvas | per component |

## Enforcement

`pointerGesture.test.ts` (census + isPinching), `touchActions.test.ts` (mobile/tablet
action drift-pin), `zoomSettle.test.ts` (gesture-exit settle), `frameHint.test.ts`
(hint contract). The inventory itself is UNENFORCED — it is a map, kept true by the
update-in-the-same-change rule above.
