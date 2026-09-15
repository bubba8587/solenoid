<!-- dte:B4 -->
# Decision provenance — DTE

This repo tracks the *why* behind its code as a **DTE** (Decision Tree Engineering)
tree, governed by B4 "Solenoid tracks decision provenance with DTE; rules.md and
decisions.md remain and are cited from the tree". The tool is vendored at `tools/dte.py`
(one file, stdlib Python 3.8+); run `python tools/dte.py --help`.

**DTE's own rules are vendored, not duplicated here.** The canonical DTE spec, agent
protocol, and overview live in `dte-rules/SPEC.md`, `dte-rules/PROTOCOL.md` and
`dte-rules/README.md` — verbatim copies so an agent can load the real rule text
into context. Read
`dte-rules/PROTOCOL.md` before creating or changing decisions. Do NOT re-create DTE's
own format/protocol/usage decisions as nodes in this tree; this tree holds only
Solenoid's own decisions. (`dte-rules/` is `.dteignore`d — its `dte:` tokens belong to
DTE's tree; note it describes DTE's OWN rings A/B/C, which are not Solenoid's rings below.)

**This does NOT replace the existing spec docs.** `docs/rules.md` (normative MUST +
enforcing test) and `docs/decisions.md` (what stands / reopen-if) stay authoritative;
their entries are lifted into the tree and cited from it over time.

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
