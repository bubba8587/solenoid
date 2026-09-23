---
aliases: ["Touch gestures"]
tags: [spec, canvas]
---
<!-- [[C93]] gestureByPointerType, [[C92]] pinchUnvetoable -->

# Spec: Touch gestures

Serves [[C93]] gestureByPointerType (what a finger, a mouse and a pen each do) and [[C92]] pinchUnvetoable (a pinch always wins). It is the inventory of what every pointer gesture means on each device configuration, and where each one is handled. The mechanics of the listeners (event phases, the finger census, the claim tests) are in [[pointer-gestures]].

Some gestures exist only as a side effect of event plumbing. Long-press to add, for example, is the browser's own long-press turning into a `contextmenu` event, and no code anywhere mentions "long-press". Such a gesture is invisible to search, so this inventory is where every gesture is written down. Adding, removing or regating a gesture updates this spec in the same change.

## Device configurations

The flags live in `coarse.ts`. Derive from them; never duplicate the tests.

| Flag | Definition | Interaction model |
|---|---|---|
| `IS_COARSE` | `(pointer: coarse)` matches | Touch-primary: bigger hit areas, touch actions in a bar. |
| `IS_MOBILE` | `IS_COARSE` and a mobile user agent (mirrored to `html.is-mobile` by `main.tsx`) | The mobile model: selection-gated nodes, the bottom action bar. |
| `IS_TABLET` | `IS_COARSE` and not a mobile user agent | The desktop interaction model, with touch actions in the top bar. |

"Request desktop site" flips the user-agent test, and that is the user's way out of the mobile model. Never gate on coarseness alone something that must flip with it.

## Standing rules

Breaking any of these breaks gestures silently.

- **Pinch listens in capture, pan and drag in bubble.** `pointerGesture.ts` counts contacts from window-capture listeners, so no component's `stopPropagation` can hide a finger. `isPinching()` (two or more fingers; a mouse or pen never counts) is the only definition. Never count raw pointers, and never move pan or drag to capture: they are vetoable on purpose. `pointerGesture.test.ts` pins this.
- **No palm rejection**, by the author's call: this is a precise editor, and nobody rests a palm on a node graph. A resting stylus is deliberately not half a pinch.
- **A finger never selects on pointerdown.** Selection lands through the tap's click, because a press can still become a pan or a pinch, and a pinch's click is swallowed by `flowPinch`'s click guard. A one-finger drag on an unselected card pans (`flowTouchPan.ts`).
- **Mobile selection gating** (`socket.css`, under `html.is-mobile`). An unselected node, Conduit, group or note makes every descendant inert, so pan and pinch win; the card itself stays tappable, and that tap selects it. Two exceptions: the resize grip is always live, and every socket is live while a cable is being dragged (`--cabling`).
- **Double-click never zooms.** Both surfaces pass `zoomOnDoubleClick={false}`. A cable double-click is detected from the click's `detail` count in `onClick` (`FlowCableEdge.tsx`), so the check runs before the single-click select toggle. A new "double-tap X" feature is a design smell here; prefer a tap or a long-press.
- **`stopDragStart`** (`coarse.ts`). Read-only node chrome and single-line fields swallow `pointerdown` on desktop, so a click can't start a node drag, but let it bubble on mobile, so a pan can start over them. It is not for drag-interactive controls or textareas, which keep a hard stop.
- **A cable drag blurs the focused field first** (`onConnectStart` in `FlowSurface`), so a mid-edit value commits before it is wired.

## The inventory

### Canvas (empty space)

| Gesture | Config | Action | Where |
|---|---|---|---|
| One-finger or left-mouse drag | all | Pan. | RF pane drag (bubble, vetoable); on an unselected card, `flowTouchPan.ts` |
| Shift + left-mouse drag; one-finger drag in touch-select mode | all | Lasso. Clockwise selects what it crosses, counterclockwise what it encloses. | `canvasLasso.ts` (wrapper capture) |
| Two-finger pinch | touch | Zoom, bounded, never snapped mid-pinch. | `flowPinch.ts` (wrapper capture), `pointerGesture.ts` |
| Wheel, or a Ctrl+wheel trackpad pinch | mouse | Zoom, proportional and capped per step. | `flowWheel.ts` and `wheelZoomDelta` (`viewPresets.ts`) |
| Tap or click | all | Clear the cable, standoff and endpoint selection. | `onPaneClick` in `FlowSurface.tsx` |
| Long-press (touch) or right-click | all | Context-menu routing: empty canvas opens the Add menu; a socket (snapped within 11px) its socket menu; a cable the cable menu; a node the node menu, headed by the node's catalog one-liner, which is the touch-reachable home of the header tooltip. Suppressed entirely while isolate is active, and skipped over a focused editable field, where the browser's own menu wins. | `canvasContextMenu.ts`: one native `contextmenu` handler. A touch long-press is the browser's own synthesis; there is no timer in our code. |
| Double-tap or double-click | all | Nothing, by design (see the standing rules). | RF props |

Other ways to add a node, none of them gestures: the mobile bar's ➕ button, the `A` key, and Insert ▸ Add node….

### Nodes

| Gesture | Config | Action | Where |
|---|---|---|---|
| Tap (released within the slop) | touch | Select, through the tap's click. | RF click selection and `flowTouchPan.ts` |
| Drag on a card | mouse; touch only when selected | Move the node, and the whole selection if it is part of one. | RF node drag (d3, bubble) |
| Stationary tap on the header label (within `HEADER_TAP_SLOP`, 4px) | all | Edit the title. | `nodeKit.tsx` |
| Tap the chevron (within the slop; a drag passes through to the node drag) | all | Collapse or expand. | `NodeCard.tsx` |
| Re-expand a square-collapsed Sparkline | all | The chevron, revealed on hover or selection (on touch, a tap selects, the chevron appears, and a second tap uses it); `NodeCard`'s `onDoubleClick` fallback also works for a mouse. | square-collapse rules in `nodeCard.css` |
| Drag the resize grip | all (live even when unselected on mobile) | Resize. | `ResizeHandle` |

### Sockets and cables

| Gesture | Config | Action | Where |
|---|---|---|---|
| Drag from a socket | all (mobile: on a selected node, or any socket while `--cabling`) | Pick up and drop a cable. | RF Handle drag (`FlowSocketHandle`, `onConnect` in `FlowSurface`) |
| Hover the dot (300ms intent) | mouse | Frame-input example hint, for an unwired frame input only. | `NodeSocket.tsx` and `frameHint.ts` |
| Hover the dot (400ms intent) | mouse | Value peek: an output socket or a wired input shows its live value as a scaled-down Display beside it (`SocketValuePeek`, the frame-hint layer's second payload kind). Leaving, a wheel or a cable pick hides it. Never shown together with the example hint. Desktop only, since touch has no hover. It arms only when the value shows as a summary chip (`isChipSummaryPeek`: a Frame, Cube, table, list, chart, diagram or LAMBDA); a scalar, text or error is already on the card in full. An output peeks its own cached value; a wired input peeks its source's output, formatted by the source node; an unwired input has nothing to peek. While the peek is up the dot's native type tooltip is suppressed. | `NodeSocket.tsx`, `frameHint.ts` and `FrameHintLayer.tsx` |
| Tap the input row | touch | Frame-input example hint, the intended touch trigger; the next tap or 4s dismisses it. The dot itself has none on purpose: a touch press on the dot begins a cable pick, which captures the pointer so the tap's release never reaches the dot, and the dot scales with the canvas anyway, down to a few pixels at overview zoom. | `MeasuredSocketRow` / `FrameHintLayer` |
| Long-press a socket | touch | Socket context menu. | `canvasContextMenu.ts` |
| Touch hit areas | coarse | Dot targets inflate to about 28px, except a Conduit's, which stay small so its body stays grabbable. Every socket grows further while cabling (from a −8px to a −14px inset on coarse pointers). | `socket.css` |
| Click or tap a cable | all | Select the cable; a ribbon selects as one entity. | `flow/FlowCableEdge.tsx` |
| Double-click a cable | mouse | Select the whole run, through the click's `detail` count, not `onDoubleClick`. | `flow/FlowCableEdge.tsx` |

### Drawn cables: the armed draw tool (`components/DrawnCableCapture.tsx`)

The tool is modal: while it is armed, a full-window sheet sits over the pane, and these gestures replace the canvas gestures above until it is disarmed. The sheet is a sibling of the pane, so it owns panning itself. Finishing disarms the tool and selects the new cable.

| Gesture | Config | Action | Where |
|---|---|---|---|
| Tap or click | all | Place a point, only within `TAP_SLOP`; a repeat tap on the last point is dropped. | `DrawnCableCapture.tsx` |
| One-finger or left-mouse drag | all | Pan the camera; place nothing. | `DrawnCableCapture.tsx` `panBy` |
| Two-finger pinch | touch | Zoom; place nothing. `flowPinch` listens in capture, so it works through the sheet. | `flowPinch.ts` |
| Double-click | mouse only | Finish, from the click's `detail`; the first click places the last point. | `DrawnCableCapture.tsx` |
| Right-click | mouse | Finish. No click is raised, so it is handled on pointerdown. | `DrawnCableCapture.tsx` |
| Undo, Finish and Cancel buttons | coarse | The touch way out, at the thumb end of the strip. Double-tap is not a finish gesture, and there is no Esc. | the hint strip |

### Drawn cables: a finished cable (`components/DrawnCableLayer.tsx`)

| Gesture | Config | Action | Where |
|---|---|---|---|
| Tap the body | touch | Select, through the tap's click. | `onBodyClick` in `DrawnCableLayer.tsx` |
| Drag the body of an unselected cable | touch | Pan; the body is pan surface until the cable is selected. | RF pane drag |
| Click or drag the body | mouse; touch only when selected | Select and move the whole cable (`nopan`). | `DrawnCableLayer.tsx` |
| Drag a point handle | all (handles show only when selected) | Move the point, never pan (`nopan`); a second finger hands off to the pinch. | `DrawnCableLayer.tsx` |
| Tap or click a handle | all | Make it the angle dial's active point. | `DrawnCableLayer.tsx` |
| Alt-click a handle | mouse | Remove the point; the panel's ✕ is the finger's version. | `DrawnCableLayer.tsx` / `DrawnCableInspector.tsx` |
| Double-click the body | mouse | Insert a point on the nearest span; the panel's + is the finger's version. | `DrawnCableLayer.tsx` |
| Touch hit areas | coarse | A 40px hit band; each handle gets an invisible ring of about 44px behind its disc. | `DrawnCableLayer.tsx` |

### Chrome (bars and pop-ups)

| Gesture | Config | Action | Where |
|---|---|---|---|
| Touch action buttons | mobile: bottom bar; tablet: top bar | Palette, undo, redo, select mode, group, delete, and on mobile ➕. Each action has one definition shared by both bars, which differ only in placement and size: undo is a synthetic Ctrl+Z through the canvas key handler and group runs the same `G` shortcut. The palette's glyph is Lucide's terminal (`>_`), since its search covers finding a node too; select mode's glyph is a dashed marquee. | `touchActions.tsx` (drift-pinned by `touchActions.test.ts`) |
| Taps in pop-ups and overlays | all | Normal UI; `stopDragStart` guards chrome that sits over the canvas. | per component |

## Enforcement

`pointerGesture.test.ts` (the census and `isPinching`), `touchActions.test.ts` (the mobile and tablet action drift pin), `zoomSettle.test.ts` (the gesture-exit settle) and `frameHint.test.ts` (the hint contract). The inventory itself is not machine-checked: it is a map, kept true by updating it in the same change as the gesture.
