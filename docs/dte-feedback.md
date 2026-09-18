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
8. **The vendored `CLAUDE.md` carries DTE-repo-local sections.** "Rings in this repo" (A core
   goals, B format of DTE, C the reference tool) and "Conventions" (Python 3.8, one file) are
   about the DTE repo, yet an adopter's agents read the vendored copy as their own protocol
   and would take DTE's ring definitions for theirs. Split the portable protocol from the
   repo-local tail, or have `vendor` strip the tail.
9. **The walkthrough is not vendored.** DTE's README lists it beside SPEC / ADOPTING / CLAUDE
   as a core doc, but `VENDOR_FILES` leaves it out, so the adopter's agents get the pointer
   and not the file.
