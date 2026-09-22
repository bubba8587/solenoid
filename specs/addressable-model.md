<!-- [[C19]] namingModel -->

# Spec: Addressable model

Serves [[C19]] namingModel. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Every node has a **stable, user-editable name**, separate from the rete-internal `id`
(which stays random/regenerated-on-load, per `rebuildGraph`'s `idMap` — names never
assume id stability). Default: a type-scoped counter (`Filter_2`), editable, validated
unique per document. (`label` is a SEPARATE per-instance display field — persisted, and edited directly by Note/Group/Image/SvgPicker/Presentation — but it is NOT the addressable name and nothing resolves references through it.)

The **text projection** (graph ↔ one-node-per-line text, name-addressed rather than
id-addressed) is a second view of the same document, alongside the canvas and the JSON
save. Grammar invariants:
- **Line order is topological (dependency order), with ties broken alphabetically by
  name**, not canvas position and not plain alphabetical. Canvas-position order would
  reshuffle the whole file on every drag, churn unrelated to the logic and the worst option
  for git diffs; topological order only changes the region a real edit touches.
- **Canonicalization on write:** numbers via JS's default shortest round-trippable
  `String(n)` (no locale formatting, no fixed padding); each node line's fields in one
  fixed schema order — name, then type, init fields in DECLARED order
  (`canonicalEntries`; unrecognized extras sorted), then `lit:`/`str:` keys
  alphabetically, then connections sorted by target input. Deterministic, never
  insertion-order: two writes of an unmodified graph must be byte-identical.
- **Visual state (position, size, collapsed, etc.) lives in a separate trailing
  block/sidecar, not inline in the per-node lines** — keeps the readable lines looking
  like code (type, name, wiring), not a scene graph.
- **The sidecar ALSO carries every non-node top-level SavedGraph field**: `positions`,
  `standoffs`, `pins`, `comments`, `seedId`, `palette`, `reportPalette`, `frameFormats`,
  `meta` (document author and tags), `packs` (and `v`). A new top-level field must be added to
  both `writeTextForm` and `readTextForm`: `serializeGraph` round-trips through the text form,
  so anything the sidecar omits is **silently dropped on every save** (the per-doc autosave
  goes through `serializeGraph` via `captureCurrent`). `comments` and `reportPalette` were once
  lost exactly this way. Node references inside the sidecar (pins/standoffs/comments `nodeId`) are name-addressed.
- The JSON save is *generated* from the text form, not hand-maintained in parallel —
  contain the two-formats-to-sync risk by making JSON strictly derived.
- Round-trip losslessness (text → graph → text is idempotent) is machine-checked the
  same way `seeds.test.ts` checks structural invariants today — load every seed, write
  text, re-read, re-write, assert the second write is byte-identical. Keep it green
  permanently, same discipline as `cablePaths.test.ts`'s continuity gate.
