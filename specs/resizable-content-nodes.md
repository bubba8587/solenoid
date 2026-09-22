<!-- [[C37]] observerOwnsSize -->

# Spec: Resizable-content nodes

Serves [[C37]] observerOwnsSize. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

When a node renders content whose size depends on live user input (slider, drag, growing list), keep the **node body (hit area + offsetParent) a constant size** and let the visible content overflow. The inspector toolbar must not ride the varying content: the Conduit's toolbar PORTALS out of the canvas transform entirely to a viewport-fixed dock (bottom-left, above `--chrome-bottom` — `ConduitComponent.tsx` `createPortal` + `conduit.css` `--docked`), so zoom and content changes can't move it.

The Conduit applies this with `CONDUIT_BODY_SIZE`, pivot at body center, the housing + sockets drawn from the pivot with `overflow: visible` (sockets absolutely positioned, can extend outside the body), toolbar at a body-relative offset. **The constant body is a PIVOT box, never a hit target** — it dwarfs the block it wraps, so an invisible 92-square would out-rank the cables, standoffs and canvas under it. `nodeClassName` marks the RF wrapper `sol-conduit-node` and flow.css makes it pointer-transparent (`!important`: RF stamps `pointer-events: all` inline on every selectable wrapper); pointers land on what is PAINTED — the shell shapes, plus the lane squares while expanded. A COMPRESSED lane takes `--inert`, reaching RF's Handle inside it too, or the bunched squares swallow every press on the block and it can never be grabbed. The **handle** is the shell's top slice, at a height that does NOT take the collapse scale: it is the one strip no cable crosses, so it stays a grab target at any lane count or zoom.

What NOT to do:
- ❌ Size the body to fit the variable content. Body grows → toolbar position shifts → jiggle.
- ❌ Try to "pin" the visible center by translating the node in `useLayoutEffect`. `area.moveNode` is async (awaits a guard pipe), so its DOM update doesn't ride the same paint as React's commit — you get a one-frame flash.
