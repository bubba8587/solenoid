# Scoping: split-screen, multi-window, Portals (unbuilt tails)

Isolate (v1 + the v2 focus overlay with auto endpoints) and Pin (incl. groups)
are BUILT — their mechanics live in code (`isolateStore.ts`, `isolate.ts`,
`isolateBoundary.ts`, `IsolateEndpoints.tsx`, `pinStore.ts`, HudStack) and in
`subsystem-invariants.md`/`architecture.md`. What remains here is the scoping
for the UNBUILT directions, kept because the cost analysis prevents
re-estimating from scratch.

One deferred Isolate note worth keeping: the endpoint terminals are display
elements joined to the selection system, NOT literal rete editor nodes — node
ops on them (delete / copy / wiring a real cable to a terminal) would need
serialization-skip, engine-inert, undo-suppress, copy/paste and render-preset
threading. Confirmed feasible; do it only if those ops are wanted.

## Portals (entry/exit named-store pairs) — FUTURE (name TBD)

A **Portal** node pair pipes a value across the graph without a drawn cable: an
**exit portal** publishes its input to a named store; an **entry portal** is a
dropdown of all exit-portal names and reads the chosen one's value. Uses:
long-range wiring, dashboards, de-cluttering. Portals share the auto-endpoint
UI from Isolate v2 — an exit portal looks like an exit endpoint — and an
Isolate overlay could later offer to "promote" an auto endpoint into a real
Portal. Design the endpoint component once with both consumers in mind.

## Split-screen (same and/or different files) — large

**Same file, second viewport.** The honest blocker: the app is built around one
`NodeEditor` + one `AreaPlugin` (`process.ts` singletons; every store, socket
watcher, and portal assumes them). Rete v2 can attach two areas to one editor
in principle, but each node gets a separate view per area, and all
position-dependent systems (MeasuredSocketRow vars, conduit layout, ribbon
geometry, standoffs, group push) read THE area. Auditing every `getArea()` call
site for "which area?" is a real refactor (~50+ sites), plus duplicated render
cost. (The composite drill-in's `activeGraph.ts` seam has since made SOME
chrome area-aware — re-count before re-estimating.)

- Cheaper variant: a **read-only second viewport** rendered from `nodeViews`
  positions with no second rete instance — a big minimap with
  click-to-navigate. Most of the "watch outputs while editing inputs" value,
  none of the dual-area risk. Medium effort.

**Different files side by side** requires multi-document dual instances — if
two files is the goal, two OS windows (below) is cheaper and more natural.

## Additional windows of the same file (Excel-style)

Plumbing is easy (Tauri `WebviewWindow` / `window.open`); sync is the real
question:

- *Viewer window (recommended v1)*: secondary windows open read-only, refreshed
  from the autosave channel (`localStorage` events fire across windows for
  free; Tauri has its event API). Latency = the autosave debounce — fine for
  "watch the dashboard while editing". A `?viewer` boot mode + canvas lock +
  reload on storage events. 2–3 days.
- *Live editing in both*: needs operation forwarding with echo suppression — a
  mini-CRDT/LWW layer over BroadcastChannel / Tauri events. Doable (mutations
  funnel through few choke points) but a serious feature with conflict
  semantics to define; if collaboration is ever on the roadmap, design this as
  its first half rather than a one-off.

Suggested order stands: viewer window first; judge split-pane / live
multi-window only after — Isolate + Pin have likely absorbed most of the
demand.
