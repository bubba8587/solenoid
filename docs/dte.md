<!-- [[B8]] -->
# Decision provenance — DTE

This repo tracks the *why* behind its code as a **DTE** (Decision Tree Engineering)
tree, governed by B8 "Solenoid's decisions and rules live only as DTE leaves; rules.md and
decisions.md retire". The tool is vendored at `tools/dte.py`
(one file, stdlib Python 3.8+); run `python tools/dte.py --help`.

**DTE's own rules are vendored, not duplicated here.** The canonical DTE spec, agent
protocol, overview, adoption guide and a render of DTE's own tree live in `dte-rules/SPEC.md`,
`dte-rules/CLAUDE.md`, `dte-rules/README.md`, `dte-rules/ADOPTING.md` and
`dte-rules/DECISIONS.md`, written by
`python tools/dte.py vendor --from <a DTE checkout> --dir dte-rules`, which also refreshes
`tools/dte.py` itself (the local copy carries two patches ahead of upstream until the author lands them: the
`.dtecoverage` store below, which feedback 14 holds, and a `decisions` key in `dte.cfg` so the
tree can live at `tree/decisions`; a re-vendor must keep both). Read them before
creating or changing decisions, and check them before filing DTE feedback. Do NOT re-create DTE's own format/protocol/usage decisions as
leaves in this tree; this tree holds only Solenoid's own decisions. (`dte-rules/` is
`.dteignore`d — its `dte:` tokens belong to DTE's tree; note it describes DTE's OWN rings
A/B/C, which are not Solenoid's rings below.)

**The tree is the one home.** Every rule that lived in the old rules.md and every decision
in the old decisions.md is a leaf now; both documents are deleted (git has them). B8
carries the field mapping (MUST →
Decision, Why/Origin → Why, Exceptions/Where/Reopen if → Consequences; the old Enforced-by
column is derived from citing tests now, never stored) and
the naming convention: a leaf lifted from a named rule carries the name in its `name`
property (`name: shareImpl`, the title is the description alone), so `python tools/dte.py find
shareImpl` finds it and a citation may read `[[<ID>]] shareImpl`. The tool prints a leaf as
`ID name: title`.

`tests/graph/rules.test.ts` guards the leaves ([[B8]] treeIsTheHome): every MUST is cited from a test or labels its debt `*Unenforced:*`, cited suites exist, quoted test names appear in them, owner ratifications match the owner-kept `OWNER_RATIFIED` list, and every `[[ID]] name` pair matches the leaf's `name`.

## Wikilinks ([[C81]] wikilinkCitations)

Solenoid writes every citation as an Obsidian wikilink, `[[C41]]` or `[[C41]] branchModel`, and
the link fields of a leaf (`parents`, `supersedes`, `superseded_by`, `conflicts_with`) as quoted
wikilinks, `parents: ["[[B7]]"]`. The author opens `tree/` as one Obsidian vault holding `decisions/` and `specs/` (its `.obsidian/` is ignored; the tool finds the decisions through `decisions = tree/decisions` in `dte.cfg`, a local patch), and each node's lineage, its
supersessions and every doc that cites it are followable links, backlinks and graph-view edges.
`links = wikilink` in `dte.cfg` is what makes the vendored tool write this form; it reads the
upstream `dte:ID` token as well, so the vendored spec below is still accurate about upstream and
only its citation syntax differs here. Code files are invisible to Obsidian, so their `[[ID]]`
lines serve the tool alone. Titles are double-quoted: the `name: summary` convention puts a
colon in them, and Obsidian rejects the whole property block when the YAML is invalid
(`fm_str` quotes on write). The wikilink patch (`cited_ids`, `LINK_RE`, `fm_id`, `fm_ids`,
`cite_text` and the `links` config key) can go upstream as it is, since DTE's own tree keeps
`links = token`; it is logged in DTE's FEEDBACK.md. The parser also accepts Obsidian's
rewrites of a leaf's properties (`null` as empty, block lists, reordered keys), and a
ratification made in the working tree does not fail the human-held check, because the leaf
at HEAD was not human-held ([[C81]] wikilinkCitations, [[C82]] vaultOutbox). Specs are
Obsidian notes too: a front matter with the spec's title as an alias and a `spec` tag, and
wikilinks to other specs by file name.

Named leaves also carry `aliases: [name]` (written from `name`), so `[[branchModel]]` resolves and the link
autocompleter offers names. The tool counts a citation only by ID, so write `[[C41]]` in code and
docs and use the alias when browsing. `tree/decisions/DTE.base` is the tree as Obsidian Bases views:
Outbox, Unratified, Contested, Inbox, All leaves. Obsidian's `aliases`, `tags` and `cssclasses`
are known fields to the tool.

## Outbox: edits made in the vault ([[C82]] vaultOutbox)

The inbox is how an agent hands a decision up to the author. The outbox is the other direction:
whatever the author designates in Obsidian is a work list, and **every agent session starts with
`python tools/dte.py outbox`** (validate prints `OUTBOX (n)` too). Three signals, no watcher, and
never a bare diff: an anonymous edit cannot be told from an agent's own unfinished work, and validate
already lists changed leaves. An edit the author wants looked at gets a `#ask` beside it.

| The author does | The agent does | Clear it with |
|---|---|---|
| Drops or writes a note in `tree/decisions/outbox/` | Reads it. A decision becomes `dte new` (or an inbox item if it is above the agent's ring), a correction becomes an edit, a question gets an answer in chat | `dte outbox --done <slug>` (deletes the note) |
| Tags a leaf `ratify` (Properties pane) or types `#ratify` in its body | `dte ratify <ID> --by "the author"` (drops the contest record; History stays as the activity log), then moves the ID into `OWNER_RATIFIED` in `rules.test.ts` | `dte outbox --done <ID>` (strips the action tags) |
| `retire` | `dte blast`, then `dte retire <ID> --by <agent> --authorized-by "the author"`, fixes the orphans | same |
| `contest` | `dte contest <ID> --again`, builds the alternatives, records the verdict, reports | same |
| `ask` beside a question or comment | Answers in chat; if it changes the leaf, makes the change and adds a History line | same |
| Types a name into `ratified_by` in the Properties pane | `dte ratify <ID> --by "<that name>"` so History records it, then the `OWNER_RATIFIED` move | clears itself |

`tree/decisions/README.md` is the vault-side cheat sheet (pin it in Obsidian); the loader never reads it as a leaf.

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
  (B11), lossless saves (B12), the AI layer (B13), the design system (B14), a lean core plus packs
  (B15), one function set on two surfaces under A5 (B16), the typed value model under A6 (B17).
- **C — architecture and the roots of each rule family** under a strategy (socketLattice,
  arraySemantics, firstClassUnits, calcModes, shareImpl, declareOnce, the save-path rules);
  **D, E — the rules that refine them**. `python tools/dte.py tree --under B17` shows one family.
  A ring-C leaf whose rule constrains a whole class of files (C27 noDataInComponents, C34
  classNameIsType) is NOT cited from every member: the class has a floor spec
  (`tree/specs/floors/components.md`, `tree/specs/floors/node-classes.md`, `tree/specs/floors/stores.md`) whose header carries a
  `covers:` glob, and blast runs leaf → spec → the files built to it. A file's own header cites
  only what is specific to it; a file with nothing specific has no header at all.

Authority (`dte.cfg`): **A:human, B:orchestrator, C+:subagent**. Assume ring B unless told
otherwise. The map binds agents, not the author.

## What is a leaf and what is a spec (the author's test)

A leaf is a product call a person could make: the author could read it, choose otherwise, and
something the user sees would change (the author, 2026-09-24). It is written in plain words, with no
code terms, and it may carry a MUST. "Could someone reverse it and would something break" is not
enough on its own: a load order or a wrapper order passes that and is still mechanics (the
retired E8 is the example). The many small,
similar technical choices that fall out of a leaf are spec content: fluid, edited freely, with
git history as their governance record, like code. Formula.js divergences are the worked
example: nobody decided "do not diverge from Formula.js"; the decision is Excel parity
([[A5]] excelParity, `../tree/specs/computation/formulajs-divergences.md` § Overrides and tripwires), and the per-name evidence is
`tree/specs/computation/formulajs-divergences.md`. One decision may govern several things when turning it off
for one would break the others; do not split those, and do not merge things that were ever
reversed independently.

## Coverage and the exclusion store (`.dtecoverage`)

`python tools/dte.py coverage` is the adoption gauge, and 100% is the target. It is reachable
only because an artifact that cites nothing BECAUSE no decision governs it is listed in
`.dtecoverage` under the reason it needs none: a `why:` line opens a group, the globs under it
(`.dteignore` syntax) belong to it. Seven groups today: toolchain and CI configuration; licences
and the pitch (reader on-ramps); queues, proposals, history and the index; fixtures and sample
data; dev tooling; stylesheets (a stylesheet implements DESIGN.md); seed documents (JSON cannot
cite). An excluded file is still
scanned, so one that cites anyway counts as cited; a glob matching nothing is reported as stale;
A spec's header may end with `covers: <globs>` (the `.dteignore` syntax): every file it matches is
built to that spec and counts as cited through it, `dte show <ID>` lists them as "via" the spec, and
`dte blast <ID>` lists them under "Built to". That is how a class-wide rule reaches its class without
a citation per file (the author's ruling, 2026-09-18: a component is built to a spec, not to the
tree). A `covers:` glob that matches nothing is stale like an exclusion. `coverage --excluded`
lists the files under each reason; `coverage --check` exits 1 below 100%, with a stale exclusion
or a stale `covers:` glob, and `rules.test.ts` runs it (with `validate`) so a push cannot regress
it. Coverage reached 100% on 2026-09-18 (1230 artifacts, 301 excluded). Everything not listed is
expected to cite, so a new file either cites or is a claim in the store. Adding a group is a claim
that a whole class of files needs no decision: say why in the `why:` line, and if the reason is
"not swept yet", that is not a reason.

## Everyday use

- Cite what you build: `python tools/dte.py cite <file> <ID>` (line-level by hand when a
  block's reason differs from the file's).
- `python tools/dte.py trace <path>` — why does this file exist, up to the core?
- `python tools/dte.py blast <ID>` — what does changing this decision touch?
- `python tools/dte.py tree` — the index; `show <ID>` for one node; `coverage --check` — the gauge
  (100%, pinned by `rules.test.ts`; `.dtecoverage` above holds what needs no citation).
- Before you finish: `python tools/dte.py validate --as <ring>` must print `OK`.

## Feedback

DTE is unfinished. Difficulties met while using it here go to `docs/dte-feedback.md`, one
numbered item each with the command, what happened and what would have helped; the author
carries them to the DTE repo and deletes the item once it is processed upstream.
