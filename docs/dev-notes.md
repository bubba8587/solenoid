# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-24b: the review leads closed, and the tree made ratifiable; author present, then remote)

- **Review leads:** every "2026-09-24 review rounds" lead is fixed with a failing test first, or inboxed (units,
  formulas vs Excel, frames, charts and schedule, stores, documents, engines, composite inner state), plus two
  rounds of follow-ups. One text-to-number reader everywhere (`decimalFromText`, hex is text, "1,234" is 1234,
  desktop engine included); the native engine carries error cells with their code; joins on units match 68 °F to
  20 °C. Full suite 6573 green, tsc clean, `dte validate` and `coverage --check` green.
- **Tree, the author's rulings:** a leaf is a product call a person could decide, in plain words, following
  from its parent (A thus B thus C); mechanics, code order and designs are specs (`docs/dte.md` § What is a leaf
  and what is a spec). "Leaf" means a tree item and "node" an app node. Our `dte-feedback.md` is the input to
  DTE's next version, and practice here leads the vendored text.
- **Tree, what stands:** about 190 leaves down to 127. About 70 moved into specs (new
  `tree/specs/floors/engineering.md`), four duplicates merged, the rules-about-rules (tree home, author-ruled,
  exceptions, spec-first, comments, wikilinks, outbox, enforcement labels) retired as DTE's job with Solenoid's
  practice in `docs/dte.md`; 16 leaves reparented to the leaf they follow from; two new B leaves ([[B18]]
  safeToShare, [[B19]] spreadsheetHabits). Every leaf's Why argues from its parent and its Decision names the
  rejected option. The author ratified A1, B1, B2, B3, B7 and E10, rewrote A5, A6 and those B leaves in their
  own words, and removed `made_by`/`by` and `name` (local `tools/dte.py` patch: the name is the first alias).
- **Open:** the ratification walk continues with the rest of ring B; 34 inbox items; desktop window-close check on
  the next build (backlog).

### SESSION DIGEST (2026-09-24: adversarial review rounds over the tree and specs; author checking in)

- **What stands:** about 20 reviewer branches, one slice each (compute, frames, values, documents, canvas,
  charts, chrome, composites, Obsidian, node classes, packs), checked code against specs and nodes; well over
  100 bugs fixed with tests, specs corrected where the code was right. Full suite about 6500 tests, green
  under `--sequence.shuffle`; `dte validate`, `coverage --check` and `cargo test --lib` green.
- **Author rulings, author present:** GROUPBY min/max over text is alphabetical ([[D76]] textMinMax); constants
  always win in a LAMBDA and a parameter named `e`/`pi`/`tau`/`phi` is `#NAME?` ([[D77]] constantsAlwaysWin,
  reversing two agent commits); the list Group By is Group Lists all the way down and prose calls the frame
  card GROUPBY; the Group card is Node Group; questions for the author go to `tree/decisions/inbox/`, never chat.
- **Tree:** the author's outbox notes were processed: D4 rewritten plainly with E1 folded in, E2 into D13 and the
  lattice spec, E4 into D15 and the spec, E5's Why says why Any Matrix can't stand in. New: [[C112]]
  noOverlapsEver (every layout op ends with `separateAll`). Contested and kept: C16, D29, C85, C89, D63, C112,
  C11 (Conduit lane exception), C43 (names its hooks), C95.
- **Units:** °C/°F are classified statically (`affineWeight`): a reading plus a number is a reading, two readings
  subtract to a delta in K, two readings added are `#UNIT!` (`READINGS_ADD`) on every surface: formulas, the
  Arithmetic and Aggregate cards, frame verbs on both engines (`readingScale` on the wire), computed columns.
  Expression computes in a shared linear display unit; a function the dimension pass doesn't know refuses a
  united argument; lookups carry their return column's unit.
- **Engines:** the frame-verb fuzzer covers window, fill, replace, slice, bind and cross join; every divergence it
  found is a named corpus case.
- **Saves and edits:** keys with `.`/`λ`/`-` are quoted in the text form (a save could break for good); literals
  no longer enter `init`; composites keep inner references, nested composites, FC docks and store state across
  reload, wrap and undo; one delete path for main canvas and drill-in; paste works from a snapshot.
- **Tests:** a `vi.mock` file outside ISOLATED fails `sourceInvariants.test.ts`; the flaky shared-pool failures
  are gone.
- **Late merges:** the webpage export escapes values after rendering and embeds images; open drafts flush before a
  switch, save or close (`draftFlush.ts`); composite inner cards keep size, collapse and flip (`savedNodeBody.ts`);
  Thermo presets declare their input units (`readInDeclaredUnit`); Triangle Solver solves in one unit; FIXED rounds
  like ROUND.
- **Open:** 30 inbox items await the author. A DTE tool patch (processed outbox items leave a review card in the
  inbox; a node dragged into `outbox/` stays a node) is stashed, not applied, pending the author's go.

