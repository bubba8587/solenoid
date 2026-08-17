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
- **A finger never selects on pointerdown** — selection lands on pointerup (a press
  can become a pan). Unselected nodes are drag-transparent to touch.
- **Mobile selection gating** (`socket.css`, gated `html.is-mobile`): an UNSELECTED
  node/conduit/group/note makes every descendant inert (pan/pinch win); the card
  itself stays tappable (that tap selects). Exceptions: the resize grip is always
  live; every socket is live while a cable drags (`--cabling`).
- **The canvas swallows `dblclick` in CAPTURE** (`areaPresets.ts`
  `installSurfacePointer`, re-applied in `Canvas.tsx`) to kill rete's
  double-click-zoom. Consequence: NO native or React double-click/double-tap handler
  fires anywhere inside the canvas — a double-activation must be detected via the
  click's `detail` count (`ConnectionComponent.tsx` does this). A new "double-tap X"
  feature is therefore a design smell here; prefer tap or long-press.
- **`stopDragStart`** (`coarse.ts`): read-only node chrome and single-line fields
  swallow pointerdown on desktop (no accidental node drag) but bubble on mobile (a
  pan may start over them). Not for drag-interactive controls or textareas — those
  keep a hard stop.
- **A cable drag blurs the focused field first** (Canvas `connectionpick`) — a
  mid-edit value commits before it is wired.

## Gesture inventory

### Canvas (empty space)

| Gesture | Config | Action | Where |
|---|---|---|---|
| 1-finger / left-mouse drag | all | pan | rete area + `areaPresets.ts` (bubble, vetoable) |
| 2-finger pinch | touch | zoom (capped) | `CappedZoom`, `pointerGesture.ts` (capture) |
| wheel / ctrl+wheel trackpad pinch | mouse | zoom (step-capped) | `CappedZoom.wheel` |
| tap / click | all | clear cable/standoff/endpoint selection (release-only, ≤6px move) | `Canvas.tsx` `clearCableSelection` |
| **long-press** (touch) / right-click | all | **context menu routing: empty canvas → ADD MENU**; socket → socket menu (≤11px snap radius); cable → cable menu; node → node menu (headed by the node's catalog one-liner — the header tooltip's touch-reachable home). Two regates: suppressed entirely while ISOLATE is active, and the handler bails on the focused editable (the browser's own menu wins there) | `canvasContextMenu.ts` — ONE native `contextmenu` handler; touch long-press is the browser's own synthesis, there is no timer in our code |
| double-tap / double-click | all | **nothing, by design** (swallowed — see invariants) | `areaPresets.ts` |

(Marquee/lasso selection exists but its trigger is not recorded here yet — verify in
`Canvas.tsx`/`touchSelectStore` before citing it anywhere.)

Other add paths (not gestures): mobile bar ➕ FAB, the `A` key, Insert ▸ Add node….

### Nodes

| Gesture | Config | Action | Where |
|---|---|---|---|
| tap (up, ≤slop) | touch | select (on POINTERUP — see invariants) | `Canvas.tsx` tap-to-select |
| drag on card | mouse; touch only when SELECTED | move node (whole selection if member) | rete node drag (bubble) |
| stationary tap on header label (≤4px `HEADER_TAP_SLOP`) | all | edit title | `nodeKit.tsx` |
| tap chevron (≤slop; drag passes through to node drag) | all | collapse/expand | `NodeCard.tsx` |
| re-expand a square-collapsed Sparkline | all | the chevron, revealed on hover OR SELECTION (touch: tap selects → chevron appears → tap it). `NodeCard`'s `onDoubleClick` fallback is a DEAD PATH (dblclick swallow) — the chevron is the only control. | `nodeCard.css` square-collapse rules |
| drag resize grip | all (live even unselected on mobile) | resize | `ResizeHandle` |

### Sockets & cables

| Gesture | Config | Action | Where |
|---|---|---|---|
| drag from socket | all (mobile: selected node, or any during `--cabling`) | pick/drop cable | rete connection plugin |
| hover dot (300ms intent) | mouse | frame-input EXAMPLE hint | `NodeSocket.tsx` + `frameHint.ts` |
| tap the input ROW | touch | frame-input EXAMPLE hint — the INTENTIONAL touch trigger; next tap or 4s dismisses. The dot itself deliberately has none: a touch press on the dot begins the cable pick, which captures the pointer (the tap's up never reaches the dot), and the dot scales with the canvas transform anyway (a few px at overview zoom). | `MeasuredSocketRow` / `FrameHintLayer` |
| long-press socket | touch | socket context menu | `canvasContextMenu.ts` |
| touch hit areas | coarse | dot targets inflate to ~28px (Conduit sockets deliberately small so its body stays grabbable); every socket grows further while cabling (coarse −8px → −14px inset; a specificity bug once SHRANK it, fixed 2026-08-09) | `socket.css` |
| click cable / tap | all | select cable (ribbons select the run) | `ConnectionComponent.tsx` |
| double-click cable | mouse | (via click `detail` count, NOT onDoubleClick) — see component | `ConnectionComponent.tsx` |

### Chrome (bars, popups)

| Gesture | Config | Action | Where |
|---|---|---|---|
| touch action buttons | mobile: bottom bar; tablet: top bar | palette/undo/redo/select/group/delete (+ mobile ➕) | `touchActions.tsx` (drift-pinned by `touchActions.test.ts`) |
| taps in popups/overlays | all | normal UI; `stopDragStart` guards chrome that sits over the canvas | per component |

### Architecture map overlay (its own surface — NOT the rete canvas)

| Gesture | Config | Action | Where |
|---|---|---|---|
| one-pointer drag | all | pan the map camera (a <6px press is a click: select card/cable) | `SpecMapView.tsx` (hicCamera `Camera`) |
| wheel | desktop | anchored zoom (native non-passive listener; React's is passive) | `SpecMapView.tsx` |
| two-pointer pinch | coarse | zoom about the midpoint (`pinchStep`) | `SpecMapView.tsx` (`hicCamera.ts`) |

## Enforcement

`pointerGesture.test.ts` (census + isPinching), `touchActions.test.ts` (mobile/tablet
action drift-pin), `zoomSettle.test.ts` (gesture-exit settle), `frameHint.test.ts`
(hint contract). The inventory itself is UNENFORCED — it is a map, kept true by the
update-in-the-same-change rule above.
