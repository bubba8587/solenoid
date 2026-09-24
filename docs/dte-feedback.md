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
4. **`scope` re-lists deliberate ring skips forever.** SKIPPED RING flags 20 C leaves whose
   parents A5 / A6 the owner placed at ring A on purpose. There is no way to say "this skip is
   intended", so the finding never clears and buries real ones. Suggest: a skip under a
   human-held parent is not a finding, or a per-node `skip_ok` the owner can set.
5. **`coverage`'s "no citing test" list is mostly nodes that cannot have tests.** 60 of 170
   here, and the list mixes goals, strategy and process rules (A / B rings, `vaultOutbox`)
   with real gaps. Limiting it to nodes whose Decision states a MUST, or to nodes cited from
   code, would make it a gauge.
6. **No tool support for the A8 migration.** A8 threeLayers says a node stores nothing from
   below, but an adopted tree is full of `*Enforced by:*` / `*Where:*` lines naming files. The
   safe migration is "delete the pointer only where the named file already cites the leaf
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
    "when the rules change" section, or `vendor` printing the A/B leaves added since the
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
11. **"Every system-describing doc is a node or a spec" is the owner's rule and the package
    never states it.** A8 says specs hold what; it does not say an adopter's existing
    mechanics docs ARE that layer and should be declared in the `specs` glob and split one
    spec per subsystem, nor that rationale docs (out-of-scope lists, deferrals, divergence
    notes) are unlifted nodes. It also needs to say what is exempt: proposals (the inbox),
    history (git), and reader on-ramps (a glossary, a mental model), which are neither why
    nor what. Without that sentence an adopter keeps a docs/ folder that duplicates the tree
    and generates parallel specs beside the docs that already were specs (this repo did
    both on the same day). Related: B28 oneContest makes a conversion sweep owe a contest
    to every unratified root before the first spec is written under it; re-homing text
    that already governs built code should not count as "new work under the node".
12. **The spec / node boundary needs one sentence in A8 or B37.** Every line of a spec can be
    framed as a decision, so an agent asked to "lift docs into nodes" will over-split. The
    owner's test (2026-09-18): a node earns its place when it is a decision someone could
    reverse and something would break; the many small, similar technical choices that *fall
    out* of a node are spec content, kept fluid, with git history as their governance
    record, like code. Worked example: "formulas must not diverge from Formula.js" is not a
    decision anyone made; the decision is Excel parity, and each Formula.js divergence is a
    consequence of it, so the per-name evidence is a spec serving that node, not twelve
    nodes. State the test and the example where `dte spec` and B38 commentsMigrate are
    introduced; it is the difference between a tree of 200 nodes and one of 2000.
13. **The Decision section needs a "feature description" tripwire.** When an agent lifts a
    mechanics doc into nodes, the easiest Decision to write opens by describing what the
    thing IS (a standoff's band formula, what a readout row shows, what fields a drawn
    cable has) and only then states the call. The owner caught three of eight such nodes
    on one pass (2026-09-18: "I trust these contain actual decisions which aren't just
    'these features exist'?"). The fix is one sentence in the node template or B37: a
    Decision names the call and its opposite; a sentence that would still be true if the
    opposite had been chosen belongs in the spec. A `validate` heuristic could flag a
    Decision whose first sentence has no modal or contrast word (never / only / must /
    not / instead) as "reads as a description".
14. **`coverage` cannot reach 100%, so it stops being a gauge.** Every repo holds artifacts no
    decision governs (package manifests, CI config, licences, fixtures, archived docs,
    stylesheets under one design system), so the number plateaus and nobody knows whether the
    remainder is debt or noise. Patched locally (`tools/dte.py`, one file ahead of upstream
    3050da4; DTE's own suite passes with six new tests in the checkout at
    `/home/user/bubba8587/decision-tree-engineering`): a `.dtecoverage` store beside
    `.dteignore`, `why:` lines opening groups of globs. Semantics that made it honest: excluded
    files are still scanned and a citing one still counts (the store says "needs none", not
    "ignore"); a glob matching nothing is stale and reported; a glob before any `why:` is an
    error; `coverage --excluded` lists files per reason; `coverage --check` exits 1 below 100% or with a stale
    exclusion (the CI hook); `scope --comments` skips excluded files; `init` scaffolds the file comment-only. With it Solenoid reads 500/1258 (39.7%)
    with 273 excluded under six reasons, and the uncited list is exactly the sweep's remaining
    work. Worth a B-ring node upstream: "every artifact cites a decision or is listed with the
    reason it needs none" is the completable form of A1's second consequence.
15. **`test_vendor_copies_rules_renders_decisions_and_ignores_them` fails on a plain checkout**
    (upstream 3050da4, unpatched): the vendored DECISIONS.md stamp embeds the refresh command
    with the source checkout's path relativised from the destination (`python
    ../../home/user/.../tools/dte.py vendor --from <your DTE checkout>`), and the test asserts
    the absolute source path is absent. Related to item 2 (the stamp forgets `--dir`): the stamp
    should print the vendored copy's own path (`python tools/dte.py vendor --from <checkout>
    --dir dte-rules`) and nothing about where the source was.
16. **A rule that governs a class of files needs a scope declaration, not a citation per member.**
    "Components never call `node.data()`" ([[C27]]) is a real decision with a sweep behind it, and
    its blast radius is every component; today the only way `blast`, `coverage` and `show` know that
    is 265 identical header lines, which drown the citation that says what each file is FOR. A leaf
    could declare `governs: src/graph/components/*` (the `.dteignore` syntax); `coverage` then counts
    the class as cited, `blast` lists it, and headers carry only the specific leaf. The owner's
    question that prompted this (2026-09-18): "if everything cites C27, is C27 really a decision?"
    It is; the citation model just has no way to say "all of these".
17. **`move` refuses a same-ring re-parent.** Giving a C leaf a new B parent (`move C10 C --parents
    B17`) answers "already at ring C" and changes nothing; the only path is editing `parents:` by
    hand and writing the History line oneself, which is exactly the kind of edit the tool exists to
    make uniform. Either `move` accepts a same-ring call with `--parents`, or a `set <ID> parents`
    field write exists. Hit while fleshing out the B ring (B16, B17: 21 leaves re-parented by hand).
    **Answered by the owner the same day, and implemented:** the scope belongs to the SPEC, not the
    leaf. A component is built to a spec, so the components spec carries `covers: src/graph/
    components/*.tsx`; `blast C27` runs leaf → spec → the files built to it, `show` lists them "via"
    the spec, `coverage` counts them, and a stale glob fails `--check`. The patch (tool + five tests)
    is on the local `coverage-store` branch of the DTE checkout. It also corrected the adopter's
    error underneath item 16: an artifact does not have to cite a TREE node; citing (or being
    covered by) the spec it is built to is the three-layer model working as A8 says.
18. **Coverage should be spec-based, and the rules should say so.** After items 14 and 16 the gauge
    still reads as "does every file cite a tree leaf", which is the wrong question: A8's layers make
    the chain code → spec → tree, and a file citing a tree leaf directly is the exception (a MUST
    the file is the one home of), not the norm. What the adopter landed here, proposed as the
    upstream shape:
    - **A spec is the scope of the files built to it.** Its header carries `covers: <globs>`
      (`.dteignore` syntax). A file the glob matches is covered; it needs no header unless it has
      something specific to say. Coverage then means: every code file is built to a cited spec
      (covered or citing one), every spec cites the tree, every MUST has a citing test. Three
      numbers, one per hop, are more honest than one blended percentage; `coverage` should print
      them (code→spec, spec→tree, MUST→test) rather than "artifacts that cite a decision".
    - **`show` and `blast` walk both hops.** `show C27` derives "implemented by" through the
      components spec ("via tree/specs/floors/components.md"); `blast C27` lists the spec, then "Built to" the
      files it covers. A file's own citations still add to both.
    - **A stale `covers:` glob is a finding**, like a stale exclusion: it means the class moved and the
      spec did not.
    - **The next gauge is thinness, not coverage.** A file covered ONLY by a floor spec (components,
      node classes, stores) has nothing specific on record; that is fine for a button, wrong for a
      unit-carrying node. `coverage` could list "covered by a floor spec only, N+ comment lines" as the
      sweep's worklist, the way `scope --comments` did for uncited files; the adopter's agent pass
      ran off exactly that list (206 files) and it is where the ten real leaves of the day came from.
    - **Rule text:** B22 (or wherever coverage is defined) should state that an artifact is covered
      when it is built to a cited spec, and A8 that a class-wide rule reaches its class through the
      class's spec, never through a citation per member. Without that sentence an adopter does what
      this one did first: 265 identical header lines and a leaf whose blast radius is "everything".
    - What is NOT changed by this: a test still cites the leaf it enforces directly (the spec is not
      an enforcer), and `.dtecoverage` still holds what needs no spec at all. Patch and tests:
      `coverage-store` branch of the DTE checkout (`covers:` parsing, `covered_by`/`covered_files`,
      `cited_by` "via", `blast` "Built to", stale-glob check; comment-line only, so a markdown heading
      that says "covers:" does not count).

19. **The scanner treats a git worktree's `.git` file as an artifact.** `coverage --check` in a
    `git worktree` fails with `.git` as the one uncited file: the walk skips a `.git` directory
    (`dirs[:] = ... d != ".git"`) but a worktree's `.git` is a file. Worked around with `.git` in
    `.dteignore`; the tool should skip `.git` whether file or directory.

20. **"Node" collides with the adopter's own vocabulary; DTE should call a decision a leaf.**
    Solenoid is a node-graph app, so "node" already means a card on its canvas, and reports like
    "E11 moved, 25 nodes' citations rewritten" were ambiguous. The owner ruled (2026-09-24) that a
    tree item is a **leaf** here. The local rename can only go so far: `validate` prints "195 nodes"
    and "Nodes changed in this working tree", `show`/`blast` and the ledger say node, the generated
    `DTE.base` view is "All nodes", the vendored `CLAUDE.md` / `SPEC.md` / `DECISIONS.md` say node
    throughout, and the next `vendor` puts it all back. Suggest DTE adopt "leaf" as its own term (it
    fits the tree metaphor better than "node"), or at least a `term = leaf` key in `dte.cfg` that the
    tool's output and the vendored text follow. One snag: the README already calls code, config and
    docs "the leaves and bark", so adopting "leaf" for decisions means renaming that half of the
    metaphor (the tool already says "artifacts", which would do).
21. **A wording-only sweep costs a History line per leaf.** The rename above touched 129 leaves; the
    "body changed with no new History line" warning demanded a line in each, all identical ("node
    reads leaf; the rule is unchanged"). That is 129 lines of History that say nothing about any
    one decision. Suggest a way to mark a change as editorial (a `--editorial` flag on a commit-level
    record, or one line in a tree-wide log) so History stays about the decision.
