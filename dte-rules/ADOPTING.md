<!-- vendored from DTE 3050da4 on 2026-09-18. Do not edit; refresh with: python tools/dte.py vendor --from <your DTE checkout> -->

<!-- dte:A4,B22,B8,B33,B34,C21 -->
# Adopting DTE in an existing project

Written for a large, live codebase as the target, but nothing here is specific to it. Adoption is incremental by design (A4, B22): coverage starts near zero and only goes up. Nothing fails until the tree itself is inconsistent.

## Day one (an hour)

1. Copy `tools/dte.py` into the project and run `python dte.py init`. It creates `decisions/`, a fully commented `dte.cfg`, and a `.dteignore` that already skips the tool itself (its citations belong to DTE's tree); add vendored, generated, and binary directories to the ignore file. Then `python dte.py vendor --from <path to a DTE checkout>`: it copies DTE's rule text (`CLAUDE.md`, `SPEC.md`, this file, `README.md`) and a render of DTE's decisions into `vendor/dte/`, stamped with the DTE commit, and ignores the directory (B39 vendoredRules, C25). Run it again to refresh. Point your agent harness at those copies with a session-start hook or a slash command; that is the harness's job, not the tree's.
2. Write the core. Sit with the owner and state the project's abstract goals in one or two sentences each. Three to six of them: `dte new A --name goalName --title "..." --by <owner> --made-by human --decision "..." --why "..."`. Everything else will hang off these, so get the wording right and keep them abstract: goals, not features. If an agent does this for the owner, the owner's "go ahead" is the authorization: the agent drafts each A node as `made_by: ai`, unratified, then runs `dte authorize <ID> --by <owner>` so `validate --as B` accepts the change; the owner ratifies later (C21).
3. Run `python dte.py validate`. It should pass with zero citations.
4. Run `python dte.py coverage`. That number is the adoption gauge.
5. Optionally `python dte.py hook`, so a commit that breaks the tree is refused.

## Growing the tree

Pick one subsystem the team understands well. For it:

- Ask of each major component: "what was decided that made this exist?" Write those as ring `B` nodes with parents in `A`. Then the choices those forced as ring `C`, and so on. Most subsystems are three or four rings deep.
- Cite from the top of each file with `dte cite <file> <ID>`. Line-level citations, written by hand, are for blocks whose reason differs from the file's.
- Decisions nobody remembers making still get a node. Write what you can infer as `made_by: ai`, `confidence: low`, with a History line naming the evidence (B34). It stays unratified until the owner confirms it; a low-confidence node is far more useful than a gap: it is a question the tree is now asking out loud.
- An existing rule corpus is lifted in one run: one markdown file per rule with `ring`, `title`, `parents` (by name) and whatever provenance the source already records, then `dte import <dir> --by <you>` (B33). Nothing is contested at import; a lifted node owes its contest when something is first built under it.
- Comments split three ways (B38 commentsMigrate). A comment that explains *why* is a decision's rationale in the wrong home: move it into the node's Why and leave `dte:ID` behind. A comment that explains *how* beyond what the block literally does belongs in a spec, if the project keeps one, and the code cites the node the spec serves. A comment that says *what* the block is and is doing stays. `dte scope --comments` lists comment-heavy files with no citation, a place to start.
- When the tree disagrees with the code, that is a finding. Either the code drifted (fix it, citing the node) or the decision changed silently (write the superseding node, retire the old one, walk the orphans).

Stop when validate is clean and coverage for that subsystem is 100%. Move on.

## Working with AI agents

Have your harness load the vendored `CLAUDE.md`; do not re-author it, and never re-create DTE's own decisions as nodes in your tree: your tree holds your decisions, DTE's rules stay DTE's (B39 vendoredRules). The vendored `DECISIONS.md` is how your agents read DTE's rules without hosting them. From then on every agent session leaves a trail of `made_by: ai` nodes, and the owner's job becomes ratification: read the unratified list at the end of each validate run, agree or supersede, set `ratified_by`.

An agent that only builds needs no ring and no tree (B42 builderAutonomy). Write the spec from the node with `dte spec <ID> --out specs/<name>.md`, fill its requirements, and hand the builder `dte brief --builder specs/<name>.md` as its whole instruction block. It cites the IDs the spec names, decides nothing, and files `dte gap` when the spec is silent; the gap lands in the inbox for whoever holds the spec. The same model can hold a ring in one session and build in the next; what makes it a builder is that it has the spec and not the tree.

Give each agent a ring (A6). Set `authority` in `dte.cfg` so the tool can say whom to ask, for example `A:human, B:orchestrator, C+:subagent`. An orchestrating agent at ring B spawns subagents at C with `dte brief C --under <the node they work beneath>` at the top of their instructions and `DTE_RING=C` in their environment; anything they try to decide at B or A lands in the inbox with a prompt to escalate. You can still decide at any ring yourself; the map binds agents, not people. The owner's own decisions, and any AI decision the owner ratifies, become human-held: an agent cannot retire or move them without a human writing `authorized_by` (B11).

## Using it

- Before changing a decision: `dte blast <ID>`. The report is the checklist.
- Before touching an unfamiliar file: `dte trace <path>`. It tells you what the file is for, all the way to the core.
- When two decisions fight: `dte conflicts`. The ring order gives the answer. If the answer is wrong, the fix is a move, not an edit.

## Beside a spec tool

Spec-driven toolchains hold the middle layer, the *what* (B37 derivedLinks: tree above, spec in the middle, code below). DTE does not replace them and is not a fourth spec format; it is the layer their files should cite. As each tool's own documentation describes it:

- **GitHub Spec Kit** writes a constitution at `memory/constitution.md` ("immutable principles that govern how specifications become code") and, per feature, `specs/<branch>/spec.md`, `plan.md` and `tasks.md`. The constitution is a prose rendering of rings A and B; each spec is a spec in DTE's sense and should cite the nodes it serves.
- **AWS Kiro** writes, per feature, `requirements.md` (user stories with acceptance criteria in EARS notation), `design.md` and `tasks.md`, with standing project context under `.kiro/steering/`. The steering files are where the vendored DTE rule text goes; each requirement should cite the node it serves.
- **OpenSpec** keeps current specs under `openspec/specs/` and each change under `openspec/changes/<name>/` as `proposal.md` ("why we're doing this, what's changing"), `design.md`, `tasks.md` and delta specs, archived on completion. A proposal's *why* is a decision: it belongs in a node, and the proposal cites it. A proposal an agent is not authorized to decide is an inbox item.

In each case the tool's per-feature files are consumed at build time and go stale after; the nodes they cite outlive them, and `dte trace` on a spec file still answers why it exists. The word for what `trace` and `blast` compute is traceability: not requirements to tests, but decisions to everything that serves them.

## Alongside graph engineering

Keep the structural graph where it is. The join key is the file path: a file's graph edges say what it touches, its citations say what it serves. When the graph says a change reaches file X, `dte trace X` says which decisions X serves, and `dte blast` on those says what else those decisions touch. Structural reach and decision reach together are the real radius.
