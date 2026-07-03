# Bundle 01 — The addressable model + text projection (Bet 2)

**Source:** `future-directions.md` Bet 2. **Verdict:** IN, whole (no phased export/
import-first route — lands as one build). **Depends on:** nothing. **Gates:** bundle 07
(CLI `--set name=val`), bundle 08 (transpiler emits into a clean text form), bundle 09
(subgraphs need stable references for their typed boundary), bundle 13 (report file's
inline-refs want stable names), and every "verdict pending" item that needs it (#2, #6,
#11, #59 if ever revisited).

## Why this is Tier 0

Today a save is one JSON blob (`{nodes[], connections[]}`) keyed by opaque IDs — not
diffable, not git-friendly, not something an AI (or a human) can reliably address by
name. Almost every "second-wave" feature in the whole 2.0 set assumes a graph has
**stable, human-readable names** it can be addressed by. Build this first.

## What must land together (author's explicit condition)

Per the VERDICT: the text projection, the stable-name scheme, and the promotion to
"real" save format land **together as one build** — not phased. Old saves keep loading
via the existing JSON reader (pre-alpha: no migration, just don't break the reader).

## NEEDS AUTHOR INPUT before code — the design session

The VERDICT explicitly requires a design session FIRST (name scheme, line grammar,
visual-state carriage, round-trip guarantees). This is not optional groundwork — it's
the first deliverable. Concretely settle, with the author, before writing code:

1. **The stable-name scheme.** Every node needs an address that survives edits. Candidates:
   a user-editable slug (like a spreadsheet named range), a positional scheme (deterministic
   from canvas position — fragile under drag), or an incrementing type-scoped counter
   (`Filter_2`) with an optional user rename. Recommend: **user-editable name, defaulted to
   a type-scoped counter, validated unique per document** — closest to how nodes already
   show a title, least new UI.
2. **The text-form grammar.** One node per line, predictable order (topological? by
   canvas position? alphabetical-by-name?), so two versions diff cleanly. Must represent:
   node type, name, literal inputs, cable connections (by name, not ID), and enough visual
   state (position, at minimum) to round-trip losslessly into the JSON.
3. **Round-trip guarantee.** Text → graph → text must be idempotent (no field churn on
   an unmodified reload) — this is what makes git diffs meaningful. Decide what's
   canonicalized (number formatting, key ordering) up front.
4. **What visual state travels in the text form vs. stays JSON-only.** Position/size
   probably belongs in a JSON-only sidecar or trailing block, not inline in the readable
   node lines — decide the split so the text form reads like code, not like a scene graph.

## Grounding — what exists today

- Save/load: `persistence.ts` (`serializeGraph`, `rebuildGraph`) — the current JSON
  reader/writer; this stays as the loader for old saves and as the generator target for
  new ones (per the Bet-2 risk note: *generate* JSON from the clean form, don't
  hand-maintain both).
- Placeholder machinery (`persistence.ts` `deriveMissingNodeSockets`, `PlaceholderNode`)
  is the precedent for "lossless even when something doesn't resolve" — the text-form
  reader should follow the same discipline (unknown line → placeholder, never silently
  dropped).
- Zero-byte files bug flagged in the prior audit — kill it as literal step zero, before
  the text-form work, since it's a pre-existing git-hostility bug independent of this
  bundle.

## Build order

1. Kill the hidden zero-bytes issue in current save files (step zero, standalone, low risk).
2. Run the design session above; write the settled scheme into
   `docs/subsystem-invariants.md` (a new "Addressable model" section) before touching code.
3. Stable-name assignment: every node gains a `name` field (defaulting from type + counter),
   editable, validated unique, persisted.
4. Text-form writer: graph → text, following the settled grammar.
5. Text-form reader: text → graph, using the placeholder pattern for anything unresolvable.
6. Round-trip test: load a seed, write text, re-read, re-write — assert byte-identical
   second write (the idempotency guarantee). This is the `cablePaths.test.ts`-style
   continuity gate for this subsystem; keep it green permanently.
7. Wire the text form as the generator source for the JSON save (JSON becomes a
   *derived* artifact, not hand-maintained in parallel).
8. Update every seed + the seed CI test (`seeds.test.ts`) to confirm nothing broke.

## Exit criteria

A graph has stable per-node names; a text projection exists and round-trips losslessly;
the JSON save is generated from the text form, not maintained separately; old saves still
load via the existing reader; the design decisions are written into
`subsystem-invariants.md`, not just implied by code.
