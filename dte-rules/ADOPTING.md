<!-- vendored from DTE 0.2 (855a723) on 2026-10-31. Do not edit; refresh with: python tools/dte.py vendor --from <a DTE checkout> --dir dte-rules -->

<!-- dte:A4,B22,B8,B33,B34,C21,B45,B44,B51,B56,B58,B54,B63,B48 -->
# Adopting DTE in an existing project

Written for a large, live codebase, but nothing here is specific to one. Adoption is incremental by design: coverage starts near zero and only goes up, and nothing fails until the tree itself is inconsistent.

## Day one (an hour)

1. Copy `tools/dte.py` into the project and run `python tools/dte.py init`. It creates the decisions directory, a commented `dte.cfg`, a `.dteignore` that skips the tool itself (its citations belong to DTE's tree), and a `.dtecoverage` that already lists DTE's own scaffold. Add vendored, generated and binary directories to the ignore file. Set `decisions` in `dte.cfg` if the tree should live somewhere else, inside an Obsidian vault for instance.
2. `python tools/dte.py vendor --from <path to a DTE checkout>`. It copies `PROTOCOL.md`, `SPEC.md`, this file, `README.md`, `WALKTHROUGH.md` and a render of DTE's own decisions into `vendor/dte/`, stamped with the DTE version and the copy's own refresh command, and ignores the directory. Point your agent harness at `vendor/dte/PROTOCOL.md` with a session-start hook or a line in your own agent instructions; that is the harness's job, not the tree's.
3. Write the core. Sit with the owner and state the project's goals in one or two sentences each, three to six of them: `dte new A --name goalName --title "..." --by <owner> --made-by human --decision "..." --why "..."`. Keep them abstract: goals, not features. If an agent drafts them, the owner's go-ahead is the authorization: the agent writes each as an AI leaf, unratified, then runs `dte authorize <ID> --by <owner>`; the owner ratifies later.
4. In your own agent instructions, say which ring an agent takes when nobody has told it, and what each ring beyond A means here. Those are yours to set; DTE defines neither.
5. `dte validate`, then `dte coverage`. The three gauges are the adoption measure.
6. Optionally `dte hook`, so a commit that breaks the tree is refused.

## Growing the tree

Pick one subsystem the team understands well.

- Ask of each major component: "what was decided that made this exist?" Write each answer that is a real call, one a person could weigh and choose otherwise, as a ring B leaf with parents in A, then the calls those forced as ring C, and so on. Most subsystems are three or four rings deep.
- Test every leaf before you write it. A sentence that would still be true had the opposite been chosen is mechanics: it belongs in a spec. A leaf that only details its parent belongs in the parent's Consequences. Expect a large share of first drafts to fail this; `dte to-spec` and `dte fold` fix the ones that got through.
- Your existing mechanics docs are your spec layer. Declare them in the `specs` globs, one per subsystem, and give each a header citing what it serves. A rationale doc (out of scope, deferred) is a set of leaves waiting to be lifted.
- A rule about a whole class of files (every component, every store) goes in the class's spec with a `covers:` glob, not a citation in every file. A file's own header cites only what is specific to it.
- Cite from the top of each file with `dte cite <file> <ID>`. Line-level citations, written by hand, are for blocks whose reason differs from the file's.
- A decision nobody remembers making still gets a leaf: an AI leaf whose Why says it is inferred and from what, with a History line naming the evidence. It stays unratified until the owner confirms it, and a guessed leaf is far more useful than a gap: it is a question the tree now asks out loud.
- An existing rule corpus is lifted in one run: one markdown file per rule with `ring`, `title`, `parents` (by name) and whatever provenance the source already records, then `dte import <dir> --by <you>`. Nothing is contested at import.
- Comments split three ways. A comment that explains *why* moves into the leaf's Why and leaves a citation behind. A comment that explains *how* moves into the spec. A comment that says *what* the block is and does stays. `dte scope --comments` and the worklist at the end of `dte coverage` are places to start.
- A file that needs no decision goes into `.dtecoverage` under a `why:` line naming the reason. "Not swept yet" is not a reason.
- A MUST gets a test that cites it, or an `*Unenforced:*` line in its Consequences. How you triage the unenforced ones is your own process.
- When the tree disagrees with the code, that is a finding. Either the code drifted (fix it, citing the leaf) or the decision changed silently (write the superseding leaf, retire the old one, walk the orphans).

Stop when validate is clean and the gauges for that subsystem read 100%. Move on.

## Working with AI agents

Have your harness load the vendored `PROTOCOL.md`; do not re-author it, and never re-create DTE's own decisions as leaves in your tree. Your tree holds your decisions; the vendored `DECISIONS.md` is how your agents read DTE's without hosting them. From then on every agent session leaves a trail of AI leaves, and the owner's job becomes ratification: read the unratified list (widest first) at the end of each validate run, agree or supersede, ratify.

An agent that only builds needs no ring and no tree. Write the spec from the leaf with `dte spec <ID> --out specs/<name>.md`, fill its requirements, and hand the builder `dte brief --builder specs/<name>.md` as its whole instruction block.

Give each agent a ring. Set `authority` in `dte.cfg`, for example `A:human, B:orchestrator, C+:subagent`. An orchestrator at ring B spawns subagents at C with `dte brief C --under <the leaf they work beneath>` and `DTE_RING=C` in their environment. The owner can still decide at any ring.

If your environment has a permission layer that guards the decisions directory, an agent that hits it stops and asks you in chat, naming the leaves. Your answer, recorded with `dte authorize`, is the authorization.

## Several branches

Parallel branches and cloud clones mint ids independently. Every leaf's uuid tells two leaves with one id apart. Before a branch merges into or rebases onto another, run `dte merge-ids <that branch> --by <you>`: every leaf here whose id the other branch gives to a different leaf takes a fresh id, its citations and children with it. `dte new` warns when the remote has branches the clone has not fetched.

A long-lived specialized branch (one that builds the product on the newest of everything, say) keeps its own subtree: an A leaf saying how the branch changes the product, with `branch: <name>`, and the leaves and specs under it. It never merges out; a finding it makes moves to other branches as a ported change.

## When the rules change

Refresh with the command in the vendored files' stamp. `vendor` prints every DTE A and B leaf added or retired since your last copy, with its Decision. For each new one:

1. Read it in `vendor/dte/DECISIONS.md` and ask what it asks of an existing tree: a new check validate will run, a field that changed, a test to apply to leaves already written.
2. Run `dte validate` and `dte coverage`. New checks name what they find.
3. Sweep. A vocabulary change is one `dte editorial --replace` line, not a History line per leaf.

## Upgrading from 0.1

1. `vendor` from a 0.2 checkout. It refreshes the tool and replaces the vendored `CLAUDE.md` with `PROTOCOL.md`; point your harness at the new file.
2. `dte upgrade`, then commit it on its own. It rewrites frontmatter only: the name becomes the leaf's one alias, uuids are backfilled stably, and `status: active`, `made_by: ai`, `confidence`, an empty `conflicts_with` and (under `retire = delete`) `supersedes` and `superseded_by` go.
3. `dte validate`. Then apply the 0.2 rules to the leaves you have: the leaf-or-spec and stakes tests, the whole-leaf test, citations only up the lineage, a label on every unenforced MUST. `to-spec` and `fold` do the moves.

## Using it

- Before changing a decision: `dte blast <ID>`. The report is the checklist.
- Before touching an unfamiliar file: `dte trace <path>`.
- When two decisions fight: `dte conflicts`. The ring order gives the answer. If the answer is wrong, the fix is a move, not an edit.

## Beside a spec tool

Spec-driven toolchains hold the middle layer, the *what*. DTE does not replace them and is not a fourth spec format; it is the layer their files should cite.

- **GitHub Spec Kit** writes a constitution at `memory/constitution.md` and, per feature, `specs/<branch>/spec.md`, `plan.md` and `tasks.md`. The constitution is a prose rendering of rings A and B; each spec should cite the leaves it serves.
- **AWS Kiro** writes, per feature, `requirements.md`, `design.md` and `tasks.md`, with standing context under `.kiro/steering/`. The steering files are where the vendored protocol goes; each requirement should cite the leaf it serves.
- **OpenSpec** keeps current specs under `openspec/specs/` and each change under `openspec/changes/<name>/` with a `proposal.md`. A proposal's *why* is a decision: it belongs in a leaf, and the proposal cites it.

In each case the per-feature files are consumed at build time and go stale after; the leaves they cite outlive them, and `dte trace` on a spec file still answers why it exists.

## Alongside graph engineering

Keep the structural graph where it is. The join key is the file path: a file's graph edges say what it touches, its citations say what it serves. When the graph says a change reaches file X, `dte trace X` says which decisions X serves, and `dte blast` on those says what else those decisions touch. Structural reach and decision reach together are the real radius.
