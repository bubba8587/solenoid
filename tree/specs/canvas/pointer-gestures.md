---
aliases: ["Pointer gestures"]
tags: [spec, canvas]
---
<!-- [[C92]] pinchUnvetoable, [[C93]] gestureByPointerType, [[C43]] oneFlowSurface, [[D71]] zoomLatticeDiscreteOnly, [[C52]] visibleSelection -->

# Spec: Pointer gestures

Serves [[C92]] pinchUnvetoable (where each gesture listens and what counts as a finger), [[C93]] gestureByPointerType (what a finger, a mouse and a pen each do) and [[C43]] oneFlowSurface (both canvases wire the gestures once). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

This spec is the mechanics of canvas pointer input: which listener handles each gesture, in which event phase, and how a finger is told apart from a mouse or pen. [[touch-gestures]] is its companion: the inventory of what every gesture does on each device.

## The ordering rule

Pinch listens in the capture phase and cannot be vetoed. Pan and node drag listen in the bubble phase and can be ([[C92]] pinchUnvetoable). Both halves matter; don't move either.

React Flow's node drag (d3-drag) and pane pan bind in bubble on the node and pane elements. The pinch listens in capture on the canvas wrapper, so it sees every two-finger move first and consumes it. No component's `stopPropagation` can hide a finger from the pinch. A control that wants the pointer for itself (a slider, a dial, a text field) can still stop the event and so block the pan and the drag. Only the zoom is unstoppable, and no call site has to remember anything to keep it that way.

## Pinch: `installFlowPinch`

`flow/flowPinch.ts`, installed on the canvas wrapper in capture, listening to touch events. It uses touch events rather than pointer events because only touch events reliably list every finger (d3 listens the same way).

1. A `touchstart` with exactly two touches arms the gesture and records the finger distance, the midpoint between the fingers, and the current viewport. If the two touches sit on the same point (distance 0, such as a palm or a stylus beside a finger) it does not arm, since there is no scale to track and arming would divide by zero and write a NaN camera.
2. Each `touchmove` with two touches, while armed, is consumed (`preventDefault` plus `stopImmediatePropagation`), so React Flow's bubble handlers never see it. It drives the viewport directly:
   - the new zoom is the start zoom times the ratio of current to start distance, bounded by `boundZoom` but not snapped to the zoom steps, so the scale tracks the fingers smoothly;
   - the world point under the starting midpoint stays pinned under the fingers, and the view pans with the midpoint.
3. A third finger disarms the gesture.
4. When fewer than two touches remain (`touchend` or `touchcancel`), the gesture ends.

**A pinch never selects.** Finger one may land on a card before the gesture can be recognized as a pinch. So when a pinch ends, a capture-phase click guard swallows every click for the next 400ms. The click is prevented, not undone afterwards.

## Wheel zoom: `installWheelZoom`

`flow/flowWheel.ts`, on the canvas wrapper in capture, like the pinch. It is the only wheel path; React Flow's `zoomOnScroll` is off.

- It acts only on wheels over the canvas (`.react-flow`). The minimap zooms itself, and panels and inspectors sit outside the pane, so none of them zoom the canvas.
- Each wheel event scales an unsnapped "virtual" zoom by `wheelZoomDelta`, then snaps it with `clampZoom`. Carrying the unsnapped value means a trackpad glide of tiny deltas still reaches the next step instead of rounding back to the current one ([[D71]] zoomLatticeDiscreteOnly). The virtual zoom resets whenever another path (the zoom pill, a fit, a pinch) has moved the zoom.
- The world point under the cursor stays pinned.

**The curve** (`viewPresets.ts`, shared by every surface). `wheelZoomDelta` normalizes the wheel to pixels (a line is 16 px, a page 400 px), multiplies by `−ZOOM_SCALE` (0.0028), and caps the result at ±`ZOOM_STEP_CAP` (0.24); the new scale is `k × (1 + delta)`. The slope is much gentler per pixel than d3's default, so a trackpad scroll glides instead of lurching, and the cap is higher, so a mouse notch still moves. The scale stays between `MIN_ZOOM` (0.1), past which the dot grid is long gone and cards are specks, and `MAX_ZOOM`, where a card fills the viewport. `boundZoom` clamps without snapping (for the pinch), `clampZoom` clamps and snaps to the nearest `ZOOM_SNAP` step, and fits snap down, so the framed content still fits after snapping.

## One finger on a card: `installTouchCardPan`

`flow/flowTouchPan.ts`, on the canvas wrapper in capture ([[C93]] gestureByPointerType). On touch, a one-finger drag that starts on an unselected card or group pans the canvas; a busy graph otherwise leaves no blank space to pan from. A selected node drags, so on touch you tap to select and then drag. Mouse and pen keep select-and-drag in one motion. The rule keys on the event's pointer type, not on the device class.

**The claim test.** A press belongs to the card pan when all of these hold:

- the target is inside a `.react-flow__node` that lacks `.selected` (RF stamps that class synchronously, which makes it the one source that is already true at `pointerdown`);
- the target is not inside a discrete control: `button, select, .react-flow__handle, [data-socket-key], .sol-rf-grip` (the last is the resize grip, which stays live).

Text fields do not veto the pan. A tap still focuses them; a drag that starts on one pans.

**What happens to a claimed press:**

1. On `touchstart` with one touch, the event is stopped. d3-drag binds `touchstart.drag` in bubble on the node, so stopping only `pointerdown` would not reach it. Left unstopped, the node drag still runs. In pan mode it looks still, because the pan follows the finger exactly and the drag's delta in flow coordinates cancels to zero, but it shows the moment panning is off (select mode).
2. On `pointerdown` from a touch, with no other finger down, the event is stopped so RF's node drag never starts. The pan records the start point and viewport.
3. Each `pointermove` of that pointer pans the viewport by the finger's offset from its start, at the start zoom.
4. `pointerup` or `pointercancel` ends the pan.

Nothing calls `preventDefault`, so the tap's click still arrives and tap-to-select keeps working. If a second finger lands mid-drag (`touchCount()` reaches 2), the pan lets go and `installFlowPinch` takes over.

## Touch-select mode

`touchSelectStore` is a toggle on touch devices for building a selection by tapping. While it is on:

- RF's `multiSelectionActive` store flag is held true (on coarse-pointer devices only), so each tap adds a card to the selection or removes it, as if Ctrl were held;
- `panOnDrag` is off, since the prop is `!(IS_COARSE && touchSelect)`;
- a one-finger drag on empty canvas draws a lasso, with no Shift needed (below);
- the card pan does nothing on unselected cards: a claimed press is stopped with no pan and no drag, but its click still arrives and toggles the card.

The flag stands in for both Shift (the lasso) and Ctrl (accumulate), which a phone has no keys for.

## What counts as a finger: the census

`pointerGesture.ts` keeps a census of contacts that are down. It is a module singleton that installs itself on import, listening on `window` in capture (`pointerdown` adds, `pointerup` and `pointercancel` remove). That is the only position that is both global and impossible to swallow.

- A contact counts as a finger when its `pointerType` is neither `mouse` nor `pen`. An unknown or missing `pointerType` counts as touch. `pointerGesture.test.ts` pins this.
- `touchCount()` is the number of fingers down, and `isPinching()` is true at two or more.
- Everything that yields to a pinch reads from here. Never count raw pointers: a resting stylus or a pressed mouse is not half a pinch.
- A `pointerup` the browser never delivers must not strand a finger, or the next one-finger gesture reads as a pinch. Two backstops: a primary touch (`isPrimary`, the first finger of a new touch sequence) drops every other finger still listed, leaving mice and pens alone; and a window `blur` empties the census (`resetPointerCensus`). The blur listener is in the bubble phase, because in capture `window` would also hear every element's blur.
- It installs on import rather than on mount, because a gesture can start on the very first frame, before any surface has mounted.

## The lasso: `installLassoSelection`

`canvasLasso.ts`, a `pointerdown` listener in capture on the canvas wrapper, so RF's pane never sees a lasso press.

**Starting.** A primary-button press starts a lasso with Shift held, or without Shift while touch-select mode is on. Anything else falls through to the pane's pan. A press inside any card starts no lasso, so a socket's cable drag survives; the test is live containment in each card's element (`view.nodeElement(id).contains`), because a CSS class list silently misses some roots. A second contact, or a press while a lasso is already active, cancels the lasso without applying it and lets the pointer through unstopped, so the pinch takes over ([[C92]] pinchUnvetoable). That check comes before the card test, so a second finger landing on a card still releases the lasso. On desktop the press is stopped, or the pane would pan under the lasso; in touch-select mode it is not, because the pinch must see the first finger.

**Drawing.** The card rectangles are read once at the start: the lasso owns the pointer, so they are stable, and reading them per frame would force an O(N) reflow. Cards hidden in a collapsed group or receded by isolate are left out, since the lasso reaches only what you can see ([[C52]] visibleSelection). A point is added on each `pointermove` at least 3 px from the last. The winding picks the mode, AutoCAD style: clockwise (a positive signed area in screen coordinates) is a crossing lasso, and counterclockwise is a window lasso.

- A window lasso takes a card when all four of its corners are inside.
- A crossing lasso takes a card when any corner is inside, when the lasso lies wholly inside the card, or when the lasso's edges cross the card's box.

The outline updates on every move, but matching is coalesced to one pass per frame, since `pointermove` fires at the mouse's poll rate. An unchanged match skips the reselect, because unselecting and reselecting re-renders every selected card. A pinch that starts mid-drag cancels the lasso, and so do a `pointercancel`, the window losing focus, Escape and the surface unmounting: a lasso the browser never finishes ends unapplied, so its outline and `lassoActiveStore` (which holds the HTML-in-canvas layer's rebuilds) never stick.

**Releasing.** The last pending frame is flushed and cables are matched too, only now, since sampling every cable's path is too heavy per frame. Each `.solenoid-cable-hit` path is sampled about every 12 screen px, capped at 64 samples so a very long cable stays cheap, and a ribbon is judged as one unit and selected whole; ghost cables are skipped. A crossing lasso takes a cable with any sample inside, a window lasso one with every sample inside. The stopped `pointerdown` still yields a `click` on release, which RF's pane would use to clear the selection, so the lasso swallows that one click and no more.

## Pens and palms

There is no palm rejection ([[C93]]). A pen is handled only as what it is, a precise pointer: it never counts toward a pinch, and it keeps select-and-drag in one motion like a mouse.

## Tablets

`IS_MOBILE` is false on a tablet (iPadOS sends a desktop user agent by default; see `coarse.ts`), so a tablet runs the desktop chrome. Because the gesture model keys on pointer type, touch on a tablet behaves exactly as on a phone: tap then drag on unselected cards, and two fingers zoom over any pixel.

## Both canvases wire the gestures once

The main canvas (`FlowCanvas`) and the composite drill-in (`FlowCompositeOverlay`) render the same `FlowSurface` ([[C43]] oneFlowSurface). `FlowSurface` installs `installFlowPinch`, `installTouchCardPan` and `installWheelZoom` on its wrapper, along with the lasso, the menus and the keyboard. A static surface (`hooks.staticView`, the landing scenes) installs none of them. Anything installed in a host instead of the surface is a behavior the other canvas silently lacks.

## Locking

Locking is CSS plus React Flow props, and both surfaces apply both halves.

- The wrapper gets `.solenoid-canvas--locked`, which sets `pointer-events: none !important` on node and group chrome and on cable hit paths (`canvas.css`). Presses and wheels fall through to the pane, so pan and zoom stay live, but nothing can be wired, selected or edited.
- The surface passes `nodesDraggable`, `nodesConnectable` and `elementsSelectable` as `!locked`.
- The Add menu does not open on a locked surface, from the A key, the menu bar, the pane's right-click or a dropped cable, since a pick would add a card. For the same reason `[` and `]` rotate nothing and Ctrl+Shift+G makes no composite while locked, beside the keys the contract's gate list names.

Keep the class on both surfaces. Without it, a locked drill-in would leave its fields and sockets editable. The keyboard half of locking is in [[react-flow-surface-contract]]: the keys that move, add or remove stand down, and the view keys stay live.

A single group's position lock is separate and finer-grained. `toFlowNodes` emits `draggable: false` for a group with `lockedPosition` (a per-node value overrides the board-wide `nodesDraggable`), and `syncTopology` compares `draggable` so toggling the lock re-projects the node. Resize is a custom grip, not an RF drag, so it stays live on a locked group.

## Opt-out classes: `.nowheel`, `.nodrag`, `.nokeys`

A figure that owns its own scrolling or keyboard puts these classes on its root, so the canvas gestures stand down for a press or focus inside it.

- **`.nowheel`.** `installWheelZoom` lets the wheel scroll the element instead of zooming, but only if some element between the target and the `.nowheel` root can actually scroll in the wheel's direction (`scrollsInDirection`). A `.nowheel` body with nothing to scroll still zooms.
- **`.nodrag`.** React Flow's own class: a press there doesn't drag the node.
- **`.nokeys`.** The keyboard version of `.nowheel` (`canvasKeyboard.ts`). The canvas key handler returns early for any key whose target has a `.nokeys` ancestor, so a focused grid cell's arrow keys don't nudge nodes and its letters don't open the Add menu or run Tidy. F9 still recomputes; it is the one key that stays live here, as it does under a modal, while presenting and while drilled in.

The Gantt figure's tree grid (`role=treegrid`) carries all three. A chart drawn as a single `<svg>` needs none.

## Stopping a press inside a card

`stopDragStart` (`coarse.ts`) answers one question for one-finger input: does a drag that starts on this element move the canvas, or belong to the element? It stops `pointerdown` on desktop, so a click can't begin a node drag, and lets it bubble on mobile (`IS_MOBILE`), so a pan can start over the element. Read-only node chrome and single-line fields use it.

Some controls keep an unconditional `stopPropagation` instead:

- controls that are themselves dragged own the pointer: sliders, dials, the Conduit, group bodies, resize handles;
- `<textarea>` and contenteditable own their scrolling and text selection;
- native popup controls (`<select>` and `LazySelect`, and `<input>` of type color, date or file) keep the stop because it also prevents a drag and keeps a press on a small control from starting a pan.

Every editable field is also shielded from node drag by the surface itself. `FlowSurface` stops `mousedown` and `touchstart` in capture on its wrapper when the target is an `input`, `textarea`, `select` or contenteditable, because d3-drag listens on the node wrapper and its filter only knows the `.nodrag` class, so a press-drag that selects text would otherwise drag the card. Focus and native text selection are default actions and still happen. Pointer events are not stopped, so the touch card pan still pans from a text field.

None of these affect the pinch, because the census and the pinch listen in capture.
