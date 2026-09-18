<!-- [[B10]] reactFlowView, [[C40]] storesRegisterForget, [[C33]] saveBindsMain; covers: src/graph/*Store.ts, src/graph/storeKit.ts, src/graph/nodeStoreRegistry.ts -->

# Spec: Module-singleton stores

What every `*Store.ts` under `src/graph/` is built to. The stores are the app-wide state that [[B10]] reactFlowView keeps outside React (`storeKit.ts` `createNotifier`); this spec is their floor, and its `covers:` line is what `dte blast` and `dte coverage` read instead of a citation per file.

1. **A store is a module singleton with a notifier**: `subscribe` / `useSyncExternalStore`-shaped, a stable primitive getter for the version snapshot, no React import.
2. **A node-keyed store registers `forget` AND `forgetAll`** with `nodeStoreRegistry` ([[C40]] storesRegisterForget), so a deleted node and a whole-graph rebuild both clear it; the registry test drives every registered store.
3. **Persisted state lives in the text form, never in a store alone** ([[C30]] saveViaTextForm): a store that outlives a reload is the mirror of a persisted field, and the load path restores it ([[C33]] saveBindsMain: a store bound to the main graph does not leak into a drill-in).
4. **A store that changes what is on screen notifies once per settled edit**, never per keystroke ([[C95]] commitOnEnter); the drawn-cable cursor is the one pointer-rate notifier and only its preview subscribes ([[C90]] drawnCablesAnnotate).
