<!-- [[C32]] autosaveSlotOrder -->

# Spec: Per-doc autosave persistence

Serves [[C32]] autosaveSlotOrder. The mechanics a builder implements: what the system does and blocks, with the decision each behaviour serves. Lifted from `docs/subsystem-invariants.md` § Per-doc autosave persistence; a WHY that is not in a node belongs in one.

Each document persists to its OWN two-slot localStorage pair
(`solenoid.docs.doc.<id>.a/.b`) plus one light two-slot INDEX pair
(`solenoid.docs.index.a/.b` — currentId + `[{id, name, updatedAt, filePath}]`, no
graphs). `persist()` writes the index always (tiny) and only the documents whose
object CHANGED. The invariants that make this correct:

- **Change detection is OBJECT IDENTITY, so `documentStoreCore.ts`'s transforms must
  stay immutable.** A changed doc must be a NEW object (`{...d, …}`); mutating a
  `SolDoc` in place means `persist()` sees the same reference and silently NEVER
  writes it. (Mutating a doc you just created, before its first persist, is fine —
  `importAsDocument` does this.) If a future transform needs to touch a doc, copy it.
- **Slot seq is a strictly-monotonic in-session counter** (seeded from `Date.now()`),
  not raw `Date.now()` — two same-millisecond writes tie, making the "newer slot"
  read ambiguous (the read could resurrect the older write). Seq is read via a
  `^\{"seq":(\d+)` prefix regex so choosing the write slot never re-parses a large
  graph blob.
- **The index is metadata only; a doc's own slot is the truth** on any field
  disagreement (the index is rewritten wholesale from memory on every persist). A
  missing/corrupt doc slot is SKIPPED on restore — the rest of the library loads.
- **Deleting a doc must remove its slots** (`removeDocSlots`) — that's the quota-frees
  half of the feature; `persist()` does it by diffing `_lastPersisted`'s keys against
  the live library.
- No migration path exists (noBackCompat): the pre-2026-07-05 whole-library keys
  (`solenoid.docs.lib.a/b`) are deleted on startup. Guard tests:
  `documentStorePersist.test.ts`.
