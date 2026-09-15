<!-- dte:B8 -->
# Decision provenance — DTE

This repo tracks the *why* behind its code as a **DTE** (Decision Tree Engineering)
tree, governed by B8 "Solenoid's decisions and rules live only as DTE nodes; rules.md and
decisions.md retire". The tool is vendored at `tools/dte.py`
(one file, stdlib Python 3.8+); run `python tools/dte.py --help`.

**DTE's own rules are vendored, not duplicated here.** The canonical DTE spec, agent
protocol, overview and adoption guide live in `dte-rules/SPEC.md`,
`dte-rules/PROTOCOL.md`, `dte-rules/README.md` and `dte-rules/ADOPTING.md` — verbatim
copies so an agent can load the real rule text into context. Read ALL FOUR before
creating or changing decisions, and check them before filing DTE feedback. Do NOT re-create DTE's
own format/protocol/usage decisions as nodes in this tree; this tree holds only
Solenoid's own decisions. (`dte-rules/` is `.dteignore`d — its `dte:` tokens belong to
DTE's tree; note it describes DTE's OWN rings A/B/C, which are not Solenoid's rings below.)

**The tree is the one home.** Every rule in `docs/rules.md` and decision in
`docs/decisions.md` is being lifted into a node; the documents are deleted once empty.
While an entry exists in both, the node wins. B8 carries the field mapping (MUST →
Decision, Why/Origin → Why, Enforced by/Exceptions/Where/Reopen if → Consequences) and
the naming convention: a node lifted from a named rule keeps the name as its title
prefix (`shareImpl: ...`), so `python tools/dte.py find shareImpl` finds it and a
citation may read `dte:<ID> shareImpl`.

## Solenoid's rings

- **A — core goals of the delivered product** (owned by the author; only the author
  ratifies A). A means is never A: Excel parity and type/unit honesty serve A1, so they are B.
- **B — high-level strategy** that helps deliver A (Excel parity, the deliberate
  divergences from Excel, the Obsidian bet, web-vs-desktop, adopting DTE).
- **C — subsystem architecture** under a strategy; **D+ — implementation** under an architecture.

Authority (`dte.cfg`): **A:human, B:orchestrator, C+:subagent**. Assume ring B unless told
otherwise. The map binds agents, not the author.

## Everyday use

- Cite what you build: `python tools/dte.py cite <file> <ID>` (line-level by hand when a
  block's reason differs from the file's).
- `python tools/dte.py trace <path>` — why does this file exist, up to the core?
- `python tools/dte.py blast <ID>` — what does changing this decision touch?
- `python tools/dte.py tree` — the index; `show <ID>` for one node; `coverage` — the gauge.
- Before you finish: `python tools/dte.py validate --as <ring>` must print `OK`.

## Feedback

DTE is unfinished; problems found while using it here are logged to the DTE repo's
FEEDBACK file for the author's review (see the memory note `dte-feedback-channel`).
