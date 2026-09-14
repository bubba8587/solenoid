<!-- dte:B4,C4 -->
# Decision provenance — DTE

This repo tracks the *why* behind its code as a **DTE** (Decision Tree Engineering)
tree, governed by B4 "Solenoid tracks decision provenance with DTE; rules.md and
decisions.md remain and are cited from the tree". The tool is vendored at
`tools/dte.py` (one file, stdlib Python 3.8+); run `python tools/dte.py --help`. The
format spec lives in the DTE repo's `SPEC.md`.

**This does NOT replace the existing spec docs.** `docs/rules.md` (normative MUST +
enforcing test) and `docs/decisions.md` (what stands / reopen-if) stay authoritative;
their entries are lifted into the tree and cited from it over time. DTE adds structured
provenance, `dte:ID` citations joined to files, and `blast`/`trace` queries.

## The rings here

- **A — core goals** (owned by the author; only the author ratifies A). A1 product
  identity, A2 Excel parity, A3 type/unit honesty, A4 pre-alpha break-freely.
- **B — strategy** under a goal (the Obsidian bet, web-vs-desktop, marketing-on-real-canvases, this adoption).
- **C — subsystem architecture** under a strategy.
- **D+ — implementation decisions** under an architecture. Deeper = caused-by, and a
  parent is always strictly shallower.

## Agent protocol (adapted from the DTE repo's CLAUDE.md)

Authority map (`dte.cfg`): **A:human, B:orchestrator, C+:subagent**. It binds agents,
not the author. Assume ring **B** unless told otherwise; spawned subagents get C+.

- **Cite what you build.** `python tools/dte.py cite <file> <ID>` inserts the token in
  the file's comment syntax; hand-write a line-level `dte:ID` when a block's reason
  differs from the file's. Cite the most specific node.
- **A choice a reviewer would ask "why?" about is a decision.** At your ring or deeper,
  `dte new <ring> --title ... --by <model> --parents ... --decision ... --why ...`
  (`--confidence low|medium` when guessing the author's preference). Shallower than your
  ring, or unsure: write `decisions/inbox/<slug>.md` and ask the author in plain chat.
- **Never hand-edit frontmatter or hand-delete a node.** Use `set` / `move` / `retire`
  (they write the `decisions/RETIRED` ledger). Never resolve a contradiction by editing
  the loser — precedence is ring position; the fix is a `move`.
- **Human-held nodes are protected** (made or ratified by a human): you may not
  supersede/revert/move/reword them without a human name in `authorized_by`.
- **Before acting under an unratified node, run one `contest`** (build/cost/judge the
  alternatives against its parents, record the verdict); then it is settled.
- **Talk in ID + title, never a bare ID.** Report every built artifact with the node
  that governs it (`ID "title"`).
- **Before you finish:** `python tools/dte.py validate --as <ring>` must print `OK`;
  copy the "Nodes changed" list into your report so the author can ratify.

## Comments become citations (C4)

Per C4 "a WHY-comment migrates into a node's Why and is replaced by a dte:ID citation;
HOW-comments stay": when you find (or would write) a comment explaining *why* code
exists, move that rationale into the governing node's `## Why` and leave a `dte:ID` in
its place. Comments explaining *how* — mechanics, gotchas, non-obvious control flow —
stay. This is `commentMinimalism` (docs/decisions.md) reaching the WHY: the node is the
one home, the citation is the pointer, and the prose can no longer drift from the
decision.

## Everyday queries

- `python tools/dte.py trace <path>` — why does this file exist (up to the core)?
- `python tools/dte.py blast <ID>` — what does changing this decision touch?
- `python tools/dte.py tree` — the whole tree (the index); `show <ID>` for one node.
- `python tools/dte.py coverage` — the adoption gauge (cited artifacts).

## Feedback

DTE is unfinished; problems found while using it here are logged to the DTE repo's
`FEEDBACK.md` for the author's review (see the memory note `dte-feedback-channel`).
