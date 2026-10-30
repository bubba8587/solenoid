# DTE feedback from Solenoid

The change list for DTE 0.2, built from Solenoid's patched copy of the tool. The vendored upstream, DTE `3050da4`
of 2026-09-18, is the first usable version; whatever holds up in Solenoid's copy is what 0.2 takes. Items keep
their original numbers so citations elsewhere stay valid, and are grouped by what 0.2 does with them: ship what's
already patched, fix what's still open, add rule text, leave Solenoid's own practice out, and drop the rest.

DTE's job is governing the tree well: the format, the tool, and the rules for writing and changing leaves. It
does not supply an adopter's process around the tree (triage, backlog, release habits, house voice), and where an
item touches that line it says which side it falls on.

## 1. In Solenoid's copy now (ship as is)

Each is a local patch in `tools/dte.py`, marked `local patch`, with tests in the DTE checkout where noted.

14. **`.dtecoverage`: coverage can reach 100%.** A store beside `.dteignore` lists files that need no decision,
    in groups opened by a `why:` line. Excluded files are still scanned and a citing one still counts; a glob
    matching nothing is stale and reported; a glob before any `why:` is an error. `coverage --excluded` lists
    files per reason, `coverage --check` exits 1 below 100% or on a stale exclusion, `scope --comments` skips
    excluded files, and `init` scaffolds the file. Worth a B leaf upstream: every artifact cites a decision or
    is listed with the reason it needs none.
16, 17, 30. **A spec's `covers:` glob scopes the files built to it.** A class-wide rule reaches its class through
    the class's spec, not a citation per member. `blast` runs leaf → spec → the files built to it, `show` lists
    them "via" the spec, `coverage` counts them as cited, and a stale glob fails `--check`. Only a comment line
    counts, so a markdown heading saying "covers:" doesn't.
24. **A leaf's name is its first alias.** `name` and `aliases` were one fact kept twice; `new` writes only
    `aliases`, and `set name` rewrites the alias.
25. **`made_by` and `by` are optional.** Provenance is "ratified or not" plus git. `new` stops writing them and
    an unratified leaf reads as the agent's work.
28. **`set_field` drops a block list's old items** when it rewrites the key (Obsidian rewrites `parents:` as a
    block list).
29. **`init`'s `.dtecoverage` template says `100%`, not `100%%`.**
41. **Lean frontmatter.** No `confidence`; under `retire = delete`, no `status` (absent means active),
    `supersedes` or `superseded_by`, since the RETIRED ledger already records each successor.
42. **Every leaf carries a `uuid`** (UUIDv7, right after `id`). `new` and `place` write it, `dte uuids`
    backfills stably (time from the leaf's date, random bits hashed from its id and title), and `validate`
    requires one, unique. The readable id stays what people cite; the uuid tells two leaves apart when two
    branches mint the same id. Solenoid's bleeding-edge generator renumbers a colliding leaf by it before
    rebasing. Open half: item 32.
- **Configurable decisions dir** (`decisions = tree/decisions` in `dte.cfg`), so the tree can sit inside an
  Obsidian vault beside the specs.
- **Wikilink citations** (`links = wikilink`): `[[C25]]` in prose and `parents: ["[[B7]]"]` in fields, read
  alongside the `dte:ID` token. The parser also accepts Obsidian's rewrites (`null` as empty, block lists,
  reordered keys) and treats `aliases`, `tags` and `cssclasses` as known fields.
- **A ratification made in the working tree doesn't fail the human-held check**, since the leaf at HEAD
  wasn't human-held.

## 2. Open tool fixes

1. **The camelCase name error gives no fix.** Add the hint (`dte set <ID> name <camelCase> --by …`).
4. **`scope` re-lists deliberate ring skips forever.** A skip under a human-held parent shouldn't be a
   finding, or the owner gets a per-leaf `skip_ok`.
7. **An empty section goes unnoticed.** `validate` should warn on one; it catches half-done edits.
18. **`coverage` should print three gauges, one per hop**: code → spec (covered or citing), spec → tree,
    MUST → citing test. It still prints one blended "artifacts that cite a decision" number. Then the next
    worklist: files covered only by a floor spec that carry N+ comment lines. This also replaces item 5 (the
    "no citing test" list, mostly goals and process rules that can't have tests, becomes the MUST → test
    gauge).
20. **DTE should call a decision a leaf.** "Node" collides with any adopter whose product has nodes. The tool
    still prints "195 nodes", "Nodes changed", "All nodes" in `DTE.base`, and the vendored text says node
    throughout. Adopt "leaf" (the README's "leaves and bark" half of the metaphor becomes "artifacts", which
    the tool already says), or at least a `term = leaf` key.
21. **A wording-only sweep costs a History line per leaf.** A tree-wide rename touched 129 leaves and each
    needed the same line. Give editorial changes their own record (an `--editorial` commit-level mark or one
    tree-wide log line) so History stays about the decision.
22. **`retire --superseded-by` keeps the old name.** Retiring D11 noAutoCross into C10 socketLattice left citations reading "C10 noAutoCross", and a
    line citing both kept a repeat. Write the winner's name, collapse a citation the line already has, and
    don't leave empty brackets behind.
23. **`reparent` takes no `--authorized-by`** and its help says "fix an orphan" though it works on any leaf.
    Accept the flag and describe it as the general re-parent (this answers item 17's same-ring move).
27. **`validate` should warn on a MUST that no test cites and that carries no `*Unenforced:*` line.** The rule
    itself is in section 3.
32. **`next` only avoids ids on refs it can see.** A cloud clone often lacks the other branches. `new` should
    fetch remote branch refs first, or warn when the remote has branches the clone lacks. The full fix is a
    `dte merge-ids` (or a git merge driver) that renumbers by uuid, generalizing Solenoid's generator step.
33. **`cite` adds a second header when the file already cites the leaf by name.** Find `[[ID]]` anywhere in
    the header comment, named or not, beside other ids, and do nothing.
35. **Unratified top rings don't stand out.** `dte unratified` should sort by ring, then by descendant count,
    and `validate` should name the unratified A and B leaves, since everything under them inherits an
    unsettled rule.
38. **Nothing stops a leaf citing a deeper ring.** `validate` should fail a `[[ID]]` in a leaf's body (History
    excepted) whose ring is deeper than the leaf's own. Rule text in section 3.
40. **Clearing a leaf's History reads as an unlogged edit.** `body_changes` compares line counts. Compare
    against HEAD's lines instead (a line HEAD lacks is new), or accept a History that opens with a reset line.
43. **`retire` carries a contest onto a successor that merely absorbed the leaf.** Folding C-something into
    B16 copied its open contest onto B16, a leaf nobody had contested. A contest belongs to the text it
    challenged; on absorb it should be dropped (or listed in the ledger), not inherited.
44. **Branch-local leaves.** A specialized branch (Solenoid's bleeding-edge) keeps an A leaf and a subtree
    that exist only there. The "a leaf deleted without retire" check compares against HEAD and the branch
    refs it sees, so moving work between branches reads as deletions. The tree needs a way to mark a subtree
    as belonging to one branch, so the check, `next` and the coverage gauges treat it as expected elsewhere.
45. **Merging a child into its parent and reverting a leaf to spec are hand work.** Both came up dozens of
    times in one sweep (a child that was an aspect of its parent, a leaf that was really mechanics). Each
    needs the same steps: move the text, rewrite citations to the parent or the spec, retire with the
    ledger line. `dte fold <child> [--into <parent>]` and `dte to-spec <ID> <spec>` would make them uniform.
46. **`new --made-by joint` still shows as "ai"** in `show` and `tree` now that `made_by` is optional. Either
    drop the flag with the field or read it back.
2, 3, 15. **The vendor stamp.** It forgets `--dir`, so the printed refresh command writes to the wrong
    place; it embeds the source checkout's path (failing upstream's own vendor test on a plain checkout); and
    `vendor` duplicates an ignore entry written as `dir` versus `dir/*`. The stamp should print the copy's
    own command (`python tools/dte.py vendor --from <checkout> --dir dte-rules`) and nothing about the source.

## 3. Rules and doc text for 0.2

The tree rules Solenoid found it needed, written generically. Most live today in `docs/dte.md` §§ Solenoid
practice and What is a leaf.

- **What is a leaf (items 12, 13).** A leaf is a call a person could decide, in plain product words; anything
  describing how the code carries it out (call order, wrappers, internal formats) is spec, kept fluid with git
  as its record. About a third of Solenoid's leaves failed this test when it was stated. The Decision
  tripwire: a Decision names the call and its opposite, and a sentence that would still be true had the
  opposite been chosen belongs in the spec. State both in the protocol where `dte new` is introduced, since
  agents that read only the protocol make mechanics leaves.
- **A child is a fork, not an aspect.** A child leaf decides a different question its parent leaves open; a
  leaf that only restates part of its parent, or adds detail to it, folds back into the parent or becomes
  spec. Solenoid's D and C sweeps merged dozens of leaves on this test.
- **A leaf cites only up its lineage (item 38).** A parent that names its child leans on a decision made under
  it and can't be weighed on its own.
- **A MUST is enforced or labeled (item 27).** Cited by the test that enforces it, or its Consequences say
  `*Unenforced:*` and why; a bug fix ships with the check that would have caught it.
- **Exceptions live under their rule,** each with a "Removed by:" naming the condition that would remove it;
  one nothing could remove means the rule was written wrong. A settled rule may carry a "Reopen if:" line.
- **A Why is the plain reason, and runs downhill.** One or two sentences a person would say; it may lean on
  the parent ("we want the parent, so we want this"), never pile up specifics to justify the parent.
- **Every system-describing doc is a leaf or a spec (item 11).** An adopter's existing mechanics docs ARE the
  spec layer: declare them, split one per subsystem. Rationale docs (out-of-scope lists, deferrals) are
  unlifted leaves. Exempt: proposals (the inbox), history (git), reader on-ramps (glossary, mental model).
  Re-homing text that already governs built code doesn't owe B28's contest.
- **A ratified leaf reads as present governance (item 26).** Ratifying drops History as well as Contest, and
  the owner may rewrite the body in their voice; git keeps the record.
- **Owner-directed rewrites settle the contest (item 37).** Say so in B28, or say the contest still runs
  against the new text. Solenoid's reading: the owner's rewrite counts.
- **The agent asks its ring (item 31).** The protocol asks rather than assumes; unanswered or unattended, an
  agent works at the shallowest ring that can still build, subagents are briefed one ring deeper, and
  `validate` warns on tree changes with no ring declared.
- **A refused tree edit stops the agent (item 34).** When the environment's safety layer refuses an edit to
  governance, the agent asks the owner for an in-chat authorization naming the leaves and never routes
  around it. `authorize` could record that word where a harness hook can check it.
- **Specialized branches get their own A leaf** saying how the branch changes the product, with B leaves for
  how it's built and specs for the specifics, all living only on that branch (tool side: item 44).
- **Spec prose.** A generic subset of Solenoid's spec style: a spec opens with what it serves; state the rule,
  not who ruled or when; one paragraph per point; every sentence reads alone, with proper names instead of
  "it" across sentences; no second person.
- **The protocol travels clean (items 8, 9, 10).** Split the portable `CLAUDE.md` protocol from DTE-repo
  sections (its own rings, its Python conventions), vendor the walkthrough the README names as a core doc,
  and give the adopter a "when the rules change" step: `vendor` prints the A and B leaves added since the
  last stamp with the action each implies, and `dte-rules/ADOPTING.md` names the sweep for an existing tree.
- **Coverage is spec-based (item 18).** Rule text: an artifact is covered when it's built to a cited spec, and
  a class-wide rule reaches its class through the class's spec.

## 4. Stays Solenoid's

Process around the tree, not the tree. 0.2 should say plainly that it defines none of these and that an adopter
sets them up its own way.

39. **Triage.** Solenoid's `*Unenforced:*` bullet plus `docs/backlog.md` § Leaves the code breaks is its own
    system. DTE's part is only the MUST-labeling rule above.
- **What each ring means** (Solenoid's A–E map), and which ring subagents get.
- **House vocabulary and voice:** "object", Frame versus table, naming the node a user sees, the UI voice in
  `DESIGN.md` §7.
- **Floor specs** (components, node classes, stores) as a naming habit; DTE needs only `covers:`.
- **Doc routines:** dev-notes digests, backlog reconcile, comments as the last resort, the outbox step at
  session start, Mermaid diagrams in specs.
- **`OWNER_RATIFIED` in `rules.test.ts`** as the owner's pin on ratification.

## 5. Dropped

5. Folded into the three gauges (item 18).
6. A one-off migration helper for A8's pointer lines; the migration is done and nobody else will repeat it.
19. A worktree's `.git` file counted as an artifact; the scanner skips it now.
36. A top-ring intent with no measure of its reach (units as a flagship, 294 of 317 cards stripping units).
    Real, but a coverage claim on a leaf is product measurement, not tree governance; item 27's MUST gauge
    covers the part DTE owns.
