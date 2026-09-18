<!-- [[B8]] -->
# Decision provenance — DTE

This repo tracks the *why* behind its code as a **DTE** (Decision Tree Engineering)
tree, governed by B8 "Solenoid's decisions and rules live only as DTE nodes; rules.md and
decisions.md retire". The tool is vendored at `tools/dte.py`
(one file, stdlib Python 3.8+); run `python tools/dte.py --help`.

**DTE's own rules are vendored, not duplicated here.** The canonical DTE spec, agent
protocol, overview, adoption guide and a render of DTE's own tree live in `dte-rules/SPEC.md`,
`dte-rules/CLAUDE.md`, `dte-rules/README.md`, `dte-rules/ADOPTING.md` and
`dte-rules/DECISIONS.md`, written by
`python tools/dte.py vendor --from <a DTE checkout> --dir dte-rules`, which also refreshes
`tools/dte.py` itself (the local copy carries one patch ahead of upstream, the `.dtecoverage`
store below, until the author lands it; feedback 14 holds the patch). Read them before
creating or changing decisions, and check them before filing DTE feedback. Do NOT re-create DTE's own format/protocol/usage decisions as
nodes in this tree; this tree holds only Solenoid's own decisions. (`dte-rules/` is
`.dteignore`d — its `dte:` tokens belong to DTE's tree; note it describes DTE's OWN rings
A/B/C, which are not Solenoid's rings below.)

**The tree is the one home.** Every rule that lived in the old rules.md and every decision
in the old decisions.md is a node now; both documents are deleted (git has them). B8
carries the field mapping (MUST →
Decision, Why/Origin → Why, Exceptions/Where/Reopen if → Consequences; the old Enforced-by
column is derived from citing tests now, never stored) and
the naming convention: a node lifted from a named rule carries the name in its `name`
property (`name: shareImpl`, the title is the description alone), so `python tools/dte.py find
shareImpl` finds it and a citation may read `[[<ID>]] shareImpl`. The tool prints a node as
`ID name: title`.

## Wikilinks ([[C81]] wikilinkCitations)

Solenoid writes every citation as an Obsidian wikilink, `[[C41]]` or `[[C41]] branchModel`, and
the link fields of a node (`parents`, `supersedes`, `superseded_by`, `conflicts_with`) as quoted
wikilinks, `parents: ["[[B7]]"]`. The author opens `decisions/` itself as a vault (its `.obsidian/` is ignored), and each node's lineage, its
supersessions and every doc that cites it are followable links, backlinks and graph-view edges.
`links = wikilink` in `dte.cfg` is what makes the vendored tool write this form; it reads the
upstream `dte:ID` token as well, so the vendored spec below is still accurate about upstream and
only its citation syntax differs here. Code files are invisible to Obsidian, so their `[[ID]]`
lines serve the tool alone. Titles are double-quoted: the `name: summary` convention puts a
colon in them, and Obsidian rejects the whole property block when the YAML is invalid.

Named nodes also carry `aliases: [name]` (written from `name`), so `[[branchModel]]` resolves and the link
autocompleter offers names. The tool counts a citation only by ID, so write `[[C41]]` in code and
docs and use the alias when browsing. `decisions/DTE.base` is the tree as Obsidian Bases views:
Outbox, Unratified, Contested, Inbox, All nodes.

## Outbox: edits made in the vault ([[C82]] vaultOutbox)

The inbox is how an agent hands a decision up to the author. The outbox is the other direction:
whatever the author designates in Obsidian is a work list, and **every agent session starts with
`python tools/dte.py outbox`** (validate prints `OUTBOX (n)` too). Three signals, no watcher, and
never a bare diff: an anonymous edit cannot be told from an agent's own unfinished work, and validate
already lists changed nodes. An edit the author wants looked at gets a `#ask` beside it.

| The author does | The agent does | Clear it with |
|---|---|---|
| Drops or writes a note in `decisions/outbox/` | Reads it. A decision becomes `dte new` (or an inbox item if it is above the agent's ring), a correction becomes an edit, a question gets an answer in chat | `dte outbox --done <slug>` (deletes the note) |
| Tags a node `ratify` (Properties pane) or types `#ratify` in its body | `dte ratify <ID> --by "the author"` (drops the contest record; History stays as the activity log), then moves the ID into `OWNER_RATIFIED` in `rules.test.ts` | `dte outbox --done <ID>` (strips the action tags) |
| `retire` | `dte blast`, then `dte retire <ID> --by <agent> --authorized-by "the author"`, fixes the orphans | same |
| `contest` | `dte contest <ID> --again`, builds the alternatives, records the verdict, reports | same |
| `ask` beside a question or comment | Answers in chat; if it changes the node, makes the change and adds a History line | same |
| Types a name into `ratified_by` in the Properties pane | `dte ratify <ID> --by "<that name>"` so History records it, then the `OWNER_RATIFIED` move | clears itself |

`decisions/README.md` is the vault-side cheat sheet (pin it in Obsidian); the loader never reads it as a node.

The author's word is the authorization (B25): an outbox item is acted on and reported, never
re-asked. When acting on it touches a human-held node or one above the agent's ring, the agent
sets `authorized_by` to the author.

## Solenoid's rings

- **A — core goals of the delivered product** (owned by the author; only the author
  ratifies A). A means is never A: Excel parity and type/unit honesty serve A1, so they are B.
- **A** also holds Excel parity (A5) and the deliberate divergences from Excel (A6), placed
  there by the owner on 2026-09-17.
- **B — high-level strategy** that helps deliver A: pre-alpha break-freely (B7), the Obsidian bet (B1),
  web-vs-desktop (B2), marketing on real canvases (B3), the tree as the one home (B8),
  rules that hold without memory (B9), the React Flow view (B10), one card per concept
  (B11), lossless saves (B12), the AI layer (B13), the design system (B14).
- **C — architecture and the roots of each rule family** under a strategy (socketLattice,
  arraySemantics, firstClassUnits, calcModes, shareImpl, declareOnce, the save-path rules);
  **D, E — the rules that refine them**. `python tools/dte.py tree --under A6` shows one family.

Authority (`dte.cfg`): **A:human, B:orchestrator, C+:subagent**. Assume ring B unless told
otherwise. The map binds agents, not the author.

## What is a node and what is a spec (the author's test)

A node is a decision someone could reverse, and something would break. The many small,
similar technical choices that fall out of a node are spec content: fluid, edited freely, with
git history as their governance record, like code. Formula.js divergences are the worked
example: nobody decided "do not diverge from Formula.js"; the decision is Excel parity
([[A5]] excelParity, [[D28]] tripwireVendorDrift), and the per-name evidence is
`specs/formulajs-divergences.md`. One decision may govern several things when turning it off
for one would break the others; do not split those, and do not merge things that were ever
reversed independently.

## Coverage and the exclusion store (`.dtecoverage`)

`python tools/dte.py coverage` is the adoption gauge, and 100% is the target. It is reachable
only because an artifact that cites nothing BECAUSE no decision governs it is listed in
`.dtecoverage` under the reason it needs none: a `why:` line opens a group, the globs under it
(`.dteignore` syntax) belong to it. Six groups today: toolchain and CI configuration; licences
and the pitch (reader on-ramps); queues, proposals, history and the index; fixtures and sample
data; dev tooling; stylesheets (a stylesheet implements DESIGN.md). An excluded file is still
scanned, so one that cites anyway counts as cited; a glob matching nothing is reported as stale;
`coverage --excluded` lists the files under each reason. Everything not listed is expected to
cite, so the uncited list IS the sweep's remaining work, not noise. Adding a group is a claim
that a whole class of files needs no decision: say why in the `why:` line, and if the reason is
"not swept yet", that is not a reason.

## Everyday use

- Cite what you build: `python tools/dte.py cite <file> <ID>` (line-level by hand when a
  block's reason differs from the file's).
- `python tools/dte.py trace <path>` — why does this file exist, up to the core?
- `python tools/dte.py blast <ID>` — what does changing this decision touch?
- `python tools/dte.py tree` — the index; `show <ID>` for one node; `coverage` — the gauge (100% is
  the target; `.dtecoverage` above holds what needs no citation).
- Before you finish: `python tools/dte.py validate --as <ring>` must print `OK`.

## Feedback

DTE is unfinished. Difficulties met while using it here go to `docs/dte-feedback.md`, one
numbered item each with the command, what happened and what would have helped; the author
carries them to the DTE repo and deletes the item once it is processed upstream.
