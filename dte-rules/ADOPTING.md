<!-- dte:A4,B22,B8 -->
# Adopting DTE in an existing project

Written for a large, live codebase as the target, but nothing here is specific
to it. Adoption is incremental by design (A4, B22): coverage starts near zero
and only goes up. Nothing fails until the tree itself is inconsistent.

## Day one (an hour)

1. Copy `tools/dte.py` into the project and run `python dte.py init`. It
   creates `decisions/`, a fully commented `dte.cfg`, and a `.dteignore`;
   add vendored, generated, and binary directories to the ignore file.
2. Write the core. Sit with the owner and state the project's abstract goals
   in one or two sentences each. Three to six of them:
   `dte new A --title "..." --by <owner> --made-by human --decision "..." --why "..."`.
   Everything else will hang off these, so get the wording right and keep
   them abstract: goals, not features.
3. Run `python dte.py validate`. It should pass with zero citations.
4. Run `python dte.py coverage`. That number is the adoption gauge.
5. Optionally `python dte.py hook`, so a commit that breaks the tree is
   refused.

## Growing the tree

Pick one subsystem the team understands well. For it:

- Ask of each major component: "what was decided that made this exist?"
  Write those as ring `B` nodes with parents in `A`. Then the choices those
  forced as ring `C`, and so on. Most subsystems are three or four rings deep.
- Cite from the top of each file with `dte cite <file> <ID>`. Line-level
  citations, written by hand, are for blocks whose reason differs from the
  file's.
- Decisions nobody remembers making still get a node. Write what you can
  infer, `made_by: human`, `by: unknown (reconstructed)`, `confidence: low`.
  A low-confidence node is far more useful than a gap: it is a question the
  tree is now asking out loud.
- When the tree disagrees with the code, that is a finding. Either the code
  drifted (fix it, citing the node) or the decision changed silently (write
  the superseding node, retire the old one, walk the orphans).

Stop when validate is clean and coverage for that subsystem is 100%. Move on.

## Working with AI agents

Put the protocol from `CLAUDE.md` into the project's agent instructions.
From then on every agent session leaves a trail of `made_by: ai` nodes, and
the owner's job becomes ratification: read the unratified list at the end of
each validate run, agree or supersede, set `ratified_by`.

Give each agent a ring (A6). Set `authority` in `dte.cfg` so the tool can
say whom to ask, for example `A:human, B:orchestrator, C+:subagent`. An
orchestrating agent at ring B spawns subagents at C with `dte brief C
--under <the node they work beneath>` at the top of their instructions and
`DTE_RING=C` in their environment; anything they try to decide at B or A
lands in the inbox with a prompt to escalate. You can still decide at any ring
yourself; the map binds agents, not people. The owner's own decisions, and
any AI decision the owner ratifies, become human-held: an agent cannot retire
or move them without a human writing `authorized_by` (B11).

## Using it

- Before changing a decision: `dte blast <ID>`. The report is the checklist.
- Before touching an unfamiliar file: `dte trace <path>`. It tells you what
  the file is for, all the way to the core.
- When two decisions fight: `dte conflicts`. The ring order gives the answer.
  If the answer is wrong, the fix is a move, not an edit.

## Alongside graph engineering

Keep the structural graph where it is. The join key is the file path: a
file's graph edges say what it touches, its citations say what it serves.
When the graph says a change reaches file X, `dte trace X` says which
decisions X serves, and `dte blast` on those says what else those decisions
touch. Structural reach and decision reach together are the real radius.
