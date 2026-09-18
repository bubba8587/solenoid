# DTE feedback from Solenoid

<!-- [[B8]] treeIsTheHome -->
Difficulties met while running the vendored tool here, for the author to carry to the DTE
repo. One numbered item each: what was run, what happened, what would have helped. Delete an
item once it is processed upstream. Written against DTE `3050da4` (vendored 2026-09-18).

1. **Name-rule change breaks existing trees without a fix hint.** After the refresh,
   `validate` failed four nodes with `name 'NAME-1' is not a camelCase identifier`. The error
   never says the fix is `dte set <ID> name <camelCase> --by ...`, and `vendor` printed no
   note that the name rule tightened. A one-line hint on the error, or a "rules that changed
   since your last vendor" line from `vendor`, would have saved a search of the tool source.
2. **`vendor --dir` stamp forgets the dir.** The stamp reads `refresh with: python tools/dte.py
   vendor --from <your DTE checkout>`; run as printed it writes to `vendor/dte/` and leaves
   `dte-rules/` stale. The stamp should carry the `--dir` that was used.
3. **`vendor` duplicated the ignore entry.** `.dteignore` already had `dte-rules`; `vendor`
   appended `dte-rules/*` because it matches the literal `<dir>/*` form only. Treat `dir` and
   `dir/*` as the same entry.
4. **`scope` re-lists deliberate ring skips forever.** SKIPPED RING flags 20 C nodes whose
   parents A5 / A6 the owner placed at ring A on purpose. There is no way to say "this skip is
   intended", so the finding never clears and buries real ones. Suggest: a skip under a
   human-held parent is not a finding, or a per-node `skip_ok` the owner can set.
5. **`coverage`'s "no citing test" list is mostly nodes that cannot have tests.** 60 of 170
   here, and the list mixes goals, strategy and process rules (A / B rings, `vaultOutbox`)
   with real gaps. Limiting it to nodes whose Decision states a MUST, or to nodes cited from
   code, would make it a gauge.
6. **No tool support for the A8 migration.** A8 threeLayers says a node stores nothing from
   below, but an adopted tree is full of `*Enforced by:*` / `*Where:*` lines naming files. The
   safe migration is "delete the pointer only where the named file already cites the node
   back", and nothing computes that. I wrote a one-off script; a `dte scope --pointers` (file
   and test names found in node bodies, with whether the file cites back) would make it
   mechanical. The `*Where:*` lines are still in this tree for that reason.
7. **Empty sections after a migration go unnoticed.** Removing the pointer blocks left 67
   nodes with an empty `## Consequences`; `validate` did not mention it. A warning for an
   empty section would catch half-done edits.
8. **The vendored `dte-rules/CLAUDE.md` carries DTE-repo-local sections.** "Rings in this repo" (A core
   goals, B format of DTE, C the reference tool) and "Conventions" (Python 3.8, one file) are
   about the DTE repo, yet an adopter's agents read the vendored copy as their own protocol
   and would take DTE's ring definitions for theirs. Split the portable protocol from the
   repo-local tail, or have `vendor` strip the tail.
9. **The walkthrough is not vendored.** DTE's README lists it beside SPEC / ADOPTING / CLAUDE
   as a core doc, but `VENDOR_FILES` leaves it out, so the adopter's agents get the pointer
   and not the file.
10. **The core change does not tell an adopter what to DO.** A8 threeLayers and B38
    commentsMigrate describe the end state (why in the tree, what in specs, how in code).
    Nothing in `vendor`'s output, `dte-rules/CLAUDE.md` or `dte-rules/ADOPTING.md` says that vendoring a
    version with a new A-ring node means a migration: generate specs from the tree for the
    subsystems that exist, move HOW comments into them, widen citations. `dte-rules/CLAUDE.md` is a
    per-session protocol (cite what you touch, migrate comments as you go); `dte-rules/ADOPTING.md`'s
    "Growing the tree" reads as day-one advice. An agent that re-vendors sees new commands
    and absorbs the rules that *fail validate* (names, pointers) and stops there. Needed: a
    "when the rules change" section, or `vendor` printing the A/B nodes added since the
    last stamp with the action each one implies; and `dte-rules/ADOPTING.md` naming the sweep for an
    existing tree ("`dte spec` each ring-C root, fill Requirements from your mechanics docs,
    then `scope --comments` file by file") as an explicit step, not something to infer.
    Five things compound here: the rules describe an end state, not a transition; `vendor`
    knows both stamp commits but prints no delta; `dte-rules/ADOPTING.md` is written for an empty tree;
    the session protocol says migrate comments "while you work", which reads as "do not
    sweep"; and nothing says which nodes get a `dte spec` (the ring-C roots is an adopter's
    inference) or whether an existing mechanics doc IS the spec layer (declare it in the
    `specs` glob) or gets replaced by generated specs. A `dte status` that groups uncited
    source files by the node their directory traces to would turn the sweep into a checklist.
