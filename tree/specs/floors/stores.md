---
aliases: ["Module-singleton stores"]
tags: [spec, floors]
---
<!-- [[B10]] reactFlowView, [[C40]] storesRegisterForget, [[C33]] saveBindsMain, [[C106]] noNativeDialogs; covers: src/graph/*Store.ts, src/graph/storeKit.ts, src/graph/nodeStoreRegistry.ts -->

# Spec: Module-singleton stores

What every `*Store.ts` under `src/graph/` is built to. The stores are the app-wide state that [[B10]] reactFlowView keeps outside React (`storeKit.ts` `createNotifier`); this spec is their floor, and its `covers:` line is what `dte blast` and `dte coverage` read instead of a citation per file.

A **store** is a plain module that holds one piece of shared state, such as which cards are collapsed, the pinned values, the toast queue, or whether a dialog is open. Components read it and re-render when it changes. A module store rather than component state lets a surface in one React tree drive a popup mounted in another (a card on the canvas opens the Script editor mounted in App), and lets Canvas's keydown handler read the state directly, with no stale closure.

There are four common kinds:

- **Node-keyed** stores: a map from node id to state, like `collapseStore`, `pinStore`, `commentStore` or `nodeNameStore`.
- **Open-state** stores: one flag or one open value, like a popup or a dialog.
- **Preference** stores: app settings kept in `localStorage`, like `gridSnapStore` and `settingsStore`.
- **Bridges**: one callback that a mounted component registers so code elsewhere can trigger it (`addMenuRequest`, `outlineSearch`).

## The rules

1. **A store is a module singleton with a notifier.** Components read a store through `useSyncExternalStore(store.subscribe, getSnapshot)`, where the snapshot getter is `store.version` or another getter that returns a primitive (like `gridSnapStore.get`), so the snapshot is stable between notifications. A store holds no React state or context; it may export a small hook built on `useSyncExternalStore`, as `gridSnapStore` (`useGridSnap`) and `cableFlowStore` do.
2. **A node-keyed store registers both `forget` and `forgetAll`** with `nodeStoreRegistry` (`registerNodeForget`, `registerNodeForgetAll`), at module scope ([[C40]] storesRegisterForget). Deleting a node live calls `forgetNode(id)` on every registrant; a whole-graph rebuild skips the per-node calls and runs `forgetAllNodes()` once, since per-node forgets during a rebuild cost O(nodes × entries). A bulk edit under a surface's rebuild gate forgets only the ids it deleted: Wrap as Composite and Unpack move a node between editors under its unchanged id, so its entries stay (`settleNodeRemoved`, [[react-flow-surface-contract]]). The bulk reset is what keeps a previous graph's ids from leaking into the next one. A store that is not node-keyed is listed, with its reason, in the sanctioned table of the `sourceInvariants` sweep, which fails for any other store that does not register, or registers only one half.
3. **Document state lives in the saved text form, never in a store alone** ([[C30]] saveViaTextForm). A store that must survive a reload mirrors a persisted field: saving reads the store into the field, and the load path writes it back (`nodeSizeStore`, `collapseStore` and `socketFlipStore` from a saved node's `size`, `collapsed` and `flipped`, on the main canvas and inside a composite's `init.internal` alike (`savedNodeBody.ts`); `standoffStore`, `pinStore`, `commentStore` and `frameFormatStore` through the side tables, which `savedSideTables` and `restoreSideTables` write and read for the main canvas and a composite's snapshot alike (`savedNodeBody.ts`), the load adding each graph's entries additively under its remapped ids). A store bound to the main graph does not leak into a composite drill-in ([[C33]] saveBindsMain). Only app preferences, not document state, go straight to `localStorage`, under a `solenoid.` key, with every read and write wrapped in try/catch so a private window still works.
4. **A store that changes what is on screen notifies once per settled edit, never per keystroke** ([[C95]] commitOnEnter). The one store that notifies at pointer rate is the drawn-cable cursor in `drawnCables.ts`, which has its own notifier that only the preview stroke subscribes to ([[drawn-cables]]).
5. **The app never calls `window.alert` or `window.confirm`**, which are unreliable in the Tauri desktop WebView ([[C106]] noNativeDialogs). `noticeStore` and `confirmStore` replace them.

## The building blocks (`storeKit.ts`)

- `createNotifier()` gives `notify`, `subscribe` and `version`. `notify()` bumps a counter and calls every listener, `subscribe(listener)` returns an unsubscribe function, and `version()` returns the counter.
- `createToggleStore(initial = false)` is an open or closed flag with `get`, `set`, `open`, `close`, `toggle` and `subscribe`. `set`, `open` and `close` do nothing when the value would not change; `toggle` always flips and notifies.
- `createValueStore<T>()` holds one value or null (closed), with `get`, `open`, `close`, `subscribe` and `version`. `open` always stores and notifies; `close` does nothing when already closed. A store that needs more verbs spreads this core and adds them on top of `get` and `open` (`cubePopup`, `scriptPopup`, `connectionDialog`).

A bridge holds a single handler. `register(fn)` returns an unregister function that clears the slot only if it still holds `fn`. `addMenuRequest` nests instead: the composite drill-in registers over the main canvas, and unregistering restores the previous opener.

## Shared slots

- **The right docks.** The node Inspector (`inspectorStore`) and the pinned Report share the right side, and the one opened last takes it: opening the Inspector closes a docked Report, and the Inspector panel watches `reportStore` for the reverse. `html.sol-inspector-docked` drives the canvas squeeze ([[layout-chrome]]). `openFor(nodeId)` sets a focus node, an explicit "inspect this node" that outranks the current selection until the user selects something new; the panel clears it.
- **The Help dialogs.** About and What's New share one modal slot (`helpDialogStore`), so only one shows at a time. `autoShowWhatsNewOnce()` shows What's New once per content release: `WHATS_NEW_VERSION` is the version of the slides, not of the app, and is bumped when they change. A first-ever visitor is recorded without the dialog, so no modal lands on their first load reveal.
- **Popups mounted once in App**, each a value store holding what the popup needs, or null when closed: `elementPicker` (the node's current symbol, and an `onPick` callback; the opener updates the node and recomputes), `pivotEditor` (the live `PivotNode`, which the popup edits in place before calling `processGraph`, plus the host's resolved accent), `scriptPopup` (the open Script node's id; opening the one already open does nothing), `connectionDialog` (optional prefilled ends, and `editId` to edit an existing connection by deleting it and adding the new one), and `cubePopup`, the nested-data viewer: one popup with a drill stack, never a second window.
- **The Reference overlay** (`frStore`): open state and the active tab (`reference`, `sockets`, `help`, `knap`, `notes`). `open(tab?)` switches tab only when one is given; `toggle` leaves the tab alone.
- `presentationStore` holds which Presentation node is running as a full-screen slideshow; the overlay owns the running index and camera, and the node holds only its ordered steps. `mobileMenuStore` lets the top bar's logo button toggle the sheet the menu bar renders on mobile.

## Notices and confirmations

- `pushNotice(message, tone = "info", ttl = 6500, action?)` queues a transient notice and returns its id. A `ttl` of 0 makes it sticky until dismissed, which is what the returned id is for. An optional single action (such as "Allow" on the network prompt) runs its `onClick` and dismisses the notice.
- `requestConfirm(message or options)` opens the confirmation dialog and resolves true or false. A confirmation still open when a new one arrives resolves false first. `answerConfirm(ok)` closes the dialog, then resolves.

## Node-keyed stores in brief

- `collapseStore`: the set of collapsed nodes. A collapsed card keeps its result box and socket dots.
- `pinStore`: one pin per node, holding which output's value to show, never the node element. `pinNodeValue` is the one place that turns a node id into a pin, and it toggles, so the same action unpins: a group has no single output and pins with an empty key, recognized by its class name ([[C34]] classNameIsType); any other node pins its first output.
- `commentStore`: node-anchored comment threads, saved as an optional field. There is no identity or permission model; a blank author becomes "Anonymous", and `update` edits only the text and the resolved flag, so a comment keeps the author who wrote it. `load` keeps the id counter above every loaded `cm<n>` id. The author name (`commentAuthorStore`, `solenoid.commentAuthor`) is local to the machine, not per document. `commentsPanelUi` holds the panel's open state outside the panel so a right-click "Add comment" can open it on one node's thread (`openFor`, read once with `consumeFocusNode`).
- `nodeNameStore`: every node's addressable name ([[addressable-model]]). `ensure(id, ctorName)` assigns a type-scoped default (`Filter_2`) if none is set; the prefix comes from the class name, or from a placeholder's missing type. `claim` is the load path: it takes a saved name as given, but an invalid or already-claimed name falls back to `ensure` rather than overwrite; a claim that renames an already-named id releases its old name. `rename` is the user path and validates identifier syntax and uniqueness in the document. Loading or renaming to a name with a counter advances that prefix's counter past it.

## App settings (`settingsStore`)

`settingsStore` holds the app-wide preferences as one object persisted under `solenoid.settings`; `initSettings()` reads it once at startup, laying any saved values over `DEFAULT_SETTINGS`. `get(key)`, `set(key, value)` (which does nothing when unchanged) and `toggle(key)` for booleans. `settingsPanel` is the Settings dialog's open flag.

A new setting takes three edits: the `Settings` interface, `DEFAULT_SETTINGS`, and an entry in `SETTINGS_SCHEMA`, which lays out the Settings dialog as titled sections of fields. A field has a `key`, a `label`, optional `help`, and a `type`:

- `boolean` (the default): a toggle;
- `folder`: a read-only path with a Choose button that opens the system folder picker (desktop only);
- `segment`: a row of mutually exclusive buttons from `options`;
- `text`: a free-text input with an optional `placeholder`.

Consecutive fields sharing an `accordion` title render inside one collapsible section, the same chrome as the Packs accordion.

The Settings dialog (`Settings.tsx`) renders from the schema, so a new field's control appears with no other change. Its sections run: Appearance (the color palette picker, [[palette-and-theme]]), the schema's sections in order, Renderer (the HTML-in-Canvas toggle, available only with Chrome's `canvas-draw-element` flag), Packs (grouped Everyday, Analysis, Science & Engineering, and Other for a pack with no declared group), then the credential sections, AI and the data API keys, at the bottom. A text field commits on blur or Enter, never per keystroke. The Data section also shows "Network for this document", with an Allow button, only when the open document is foreign and still undecided: it is the way back to Allow after the network notice is dismissed. A field marked `disabledOnMobile` has no mobile counterpart, so every consumer must both gray the control and skip the behavior, never silently do nothing. The dialog grays it with "Not available in mobile mode." rather than hiding it, so the page keeps one shape and a user who knows the desktop app still finds the row, and the Command Palette does not offer it on mobile ([[C98]] paletteMirrorsMenubar). Minimap position is one, since the minimap does not render on mobile; Always show Command Palette is the other, since the palette is anchored to the top on mobile and has no bottom strip to dock to.

Some settings act through CSS: on every change the store sets classes on `<html>` so any React root's CSS can respond. `hideGridDots` sets `perf-no-grid-dots`; `minimapPosition` sets `minimap-top` or `minimap-hidden` ([[layout-chrome]]); `headerTitleCase` sets one of `hdr-case-upper`, `hdr-case-proper` and `hdr-case-as-typed`, a `text-transform` on the card title's display element only, never on the editing input, which shows the raw text.

`gridSnapStore` is a separate preference (`solenoid.gridSnap`). Its snap step is the canvas dot spacing, `DOT_SPACING` = 24 world units, so snapped positions land exactly on visible dots: `FlowSurface` offsets React Flow's background pattern onto the same lattice React Flow's `snapToGrid` uses, and `syncSurfaceBackground` scales the dot tile from it. `snapCoord` rounds a world coordinate to the nearest dot and never returns −0.
