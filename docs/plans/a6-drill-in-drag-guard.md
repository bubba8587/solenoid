# A6 — Shared node drag guard for BOTH editing surfaces (the dead drill-in finger pan)

**Goal.** Extract Canvas's inline `patchDragGuard` into `areaPresets.ts` as
`installNodeDragGuard(area, editor, opts)` and install it from both `nodecreated` pipes
(main canvas + composite drill-in), with the touch companions (tap-to-select on
pointerup, pinch veto), so a finger press on an unselected node inside a drill-in falls
through to a PAN. Pin in `surfaceParity.test.ts`. Main-canvas behavior must not change.

Use the largest model available for this one; it touches gesture code with several
recorded traps.

**Read first.** `CLAUDE.md` "Pointer gestures" bullet + the PINCH/PAN architecture note;
`docs/subsystem-invariants.md` § Pointer gestures IN FULL; `docs/touch-gestures.md`.
Non-negotiables: pinch counted in CAPTURE, pan/drag in BUBBLE; `isPinching()` is the only
pinch definition; selection on pointerup, never pointerdown.

**Backlog lines to delete when done:** A6 and the bug "A finger pan is DEAD inside a
drill-in" (`docs/backlog.md`; its `Canvas.tsx:591-631` pointer is stale — the code is at
`src/graph/Canvas.tsx:566-632`).

## Where it is

- Guard: `src/graph/Canvas.tsx:566-632` — `patchDragGuard(id)` defined inside `init()`
  (captures `area`, `editor`, `isSelected` at `:413-414`); installed from `editor.addPipe`
  on `nodecreated` via `requestAnimationFrame` (`:618-632`). Branches, in order:
  lock (`canvasLockStore.get()`) → false; touch on an unselected node → false;
  non-primary mouse/pen button → false; `isPinching()` → false; expanded `GroupNode`
  edge band (`GROUP_EDGE_BAND = 16`, header `.solenoid-group__header`) → band test;
  else true.
- Companions (Canvas-local): pointer census effect `:285-334` (refs `:110-124`:
  `activePointersRef`, `tapNodeIdRef`, `tapControlNodeIdRef`, `tapMovedRef`,
  `gestureMultiRef`, `tapTouchRef`, `tapOnCanvasRef`; `nodeAndControl(target)` walks
  `area.nodeViews`); tap-to-select on pointerup `:475-490` inside the area pipe
  `:424-506`; `selectable` from `:508`.
- Drill-in pipe: `src/graph/components/CompositeEditorOverlay.tsx:115-132` installs
  `installErrorGuards` only. Its surface installs `:106-111`
  (`installSurfacePointer/Background/SemanticZoom`, `installPinchTranslateVeto`);
  `selectable`/`selector` `:67-69`; the lock-class mirror workaround `:157-158`
  (superseded by the guard's lock branch — delete it once the guard covers it).
- `src/graph/areaPresets.ts` already imports `canvasLockStore` (`:12`) and `isPinching`
  (`:14`); exports at `:30-203`. It must NOT import `GroupNode` — the group branch goes
  behind `opts.groupBand?: (id, e, view) => boolean | undefined`.
- Pin file: `src/graph/surfaceParity.test.ts` — installer list `:63-73`; the last test
  `:107-113` currently ENCODES the bug ("Canvas patches its own drag guard inline") and
  must be rewritten.
- CSS partner: `src/graph/canvas.css:51` (rule that exists for `patchDragGuard`) —
  confirm it reaches the drill-in host too.

## Steps

1. **Extract, no behavior change.** Add to `areaPresets.ts`
   `export function installNodeDragGuard(area, editor, opts): (id: string) => void`
   returning the per-node patcher. Body = the current guard verbatim; `isSelected` from
   `editor.getNode(id)?.selected`. Canvas passes `groupBand` implementing the
   `GroupNode` branch (the `GroupNode` import stays in Canvas) and calls the patcher in
   the same `requestAnimationFrame`. Commit. Main canvas identical.
2. **Install in the drill-in.** In `CompositeEditorOverlay.tsx`'s `nodecreated` branch,
   call the patcher the same way (rAF). No `groupBand`.
3. **Companions.** Without tap-to-select an unselected card becomes untouchable in the
   drill-in. Extract the pointer census + the pointerup tap-to-select into a shared
   `installTapSelect(area, editor, selectable, container)` (in `areaPresets.ts`, or a
   new `tapSelect.ts` beside `pointerGesture.ts` if it outgrows the file), used by both
   surfaces. The two sibling pointerup branches at `:456-474` stay in Canvas if they are
   Canvas-only chrome concerns, else move too. Selection on pointerup only;
   `gestureMultiRef` (≥2 contacts) vetoes. Commit.
4. **Pins** in `surfaceParity.test.ts`: add `"installNodeDragGuard"` and the tap-select
   installer to the `it.each` list at `:63-73`; rewrite `:107-113` to assert both
   surfaces install the shared guard and `areaPresets.ts` matches
   `/installNodeDragGuard[\s\S]*isPinching\(\)/`.
5. **Verify by emulation (agent-run, sanctioned).** No touch script exists yet; write
   `scripts/touch-pan-probe.mjs` from the `puppeteer-core` + Edge template in
   `scripts/tune-seeds.mjs:15-31`: emulate a phone (`hasTouch`, `isMobile`, iPhone UA),
   load a seed containing a composite (grep the seeds for `runMode`), open the
   drill-in, CDP `Input.dispatchTouchEvent` a one-finger drag starting ON an unselected
   node, read the camera transform before/after (grep Canvas for the `window.__solenoid`
   debug handles to find how to reach the area). Expect: camera moved, 0 nodes moved,
   on BOTH surfaces. Also: a tap with no move selects; a two-finger gesture never
   selects. Keep the script (it is the regression probe); record the numbers in the
   digest.
6. Delete the lock-class mirror at `CompositeEditorOverlay.tsx:157-158` if the guard's
   lock branch covers the drill-in (toggle the lock pill in the probe to check).

## Done when

- `surfaceParity.test.ts` + full suite + `tsc` green; probe numbers in the digest;
  `docs/touch-gestures.md` amended only if it had a row claiming no drill-in finger pan;
  both backlog lines deleted; this file deleted.
- Author eyeball list: on a phone or devtools touch emulation, open a composite,
  finger-pan over cards, pinch, tap a card to select.
