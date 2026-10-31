<!-- vendored from DTE 0.2 (855a723) on 2026-10-31. Do not edit; refresh with: python tools/dte.py vendor --from <a DTE checkout> --dir dte-rules -->

<!-- dte:A1,A2,A3,A4,A5,A6,A8,A9,B1,B3,B4,B10,B11,B12,B13,B14,B15,B16,B21,B24,B29,B27,B30,B31,B32,B33,B35,B40,B42,B43,B44,B45,B46,B47,B48,B49,B50,B51,B52,B53,B54,B57,B58,B59,B60,B61,B62,B63,B64 -->
# DTE Specification (0.2)

This document is normative. Words in **bold** are defined terms. Each section cites the leaves it derives from; a leaf's file holds the reasoning. How the reference tool carries each rule out is in `specs/`.

## 1. Premise

Nothing in a project can exist without a decision having been made (dte:A2). Some decisions are made by humans, some by AI, some jointly (dte:A3). DTE records the decisions as a tree of **rings** and links every **artifact** to the decisions it serves, so the **blast radius** of changing any decision is knowable (dte:A1).

DTE is not a dependency graph. It records *why*, not *what calls what* (dte:A4).

DTE governs the tree: its format, its tool, and the rules for writing and changing leaves. It defines no process around the tree (triage, backlog, release habits, house voice, naming habits for specs); an adopter sets those up its own way (dte:B57).

## 2. Vocabulary

- **Leaf**: one recorded decision, a markdown file under `decisions/<ring>/` (dte:B1, dte:B50).
- **Ring**: a leaf's depth from the core. `A` is the core, `B` the next ring out, and so on (dte:B32).
- **Core**: ring `A`, the project's goals. Core leaves have no parents (dte:B10).
- **Parent**: a leaf this leaf exists *because of*, always in a strictly shallower ring (dte:B10). A **child** decides a question its parent leaves open (dte:B48).
- **Artifact**: any file in the project that is not a leaf: code, config, docs, tests, data.
- **Spec**: an artifact in the `specs` layer that says what to build; it cites the leaves it serves (dte:A8).
- **Citation**: `dte:ID` or `[[ID]]` in an artifact, meaning "this exists because of ID" (dte:B3).
- **Blast radius** of a leaf: every descendant, every artifact citing it or a descendant (and every file built to a citing spec), and every leaf it superseded (dte:A1).
- **Precedence**: when two in-effect leaves contradict, the shallower ring wins (dte:B4).
- **Human-held**: a leaf made by a human, or ratified by one (dte:B11).
- **Authority**: the ring an agent operates at. It decides at that ring or deeper and asks upward for anything shallower (dte:A6).
- **Inbox**: where a decision waits, without an id, until someone with authority places it (dte:B14).
- **Outbox**: the human-to-agent channel: a note in `decisions/outbox/`, an action tag on a leaf, or a `ratified_by` typed in by hand (dte:B31).
- **Name**: a leaf's camelCase handle, its one alias, unique among in-effect leaves; it always accompanies the id when a model refers to the leaf (dte:A5, dte:B32). **Title** is the one-sentence description behind it (dte:B16).
- **Ledger**: `decisions/RETIRED`, one line per retired leaf, burning its number for good and naming any successor (dte:B24).

## 3. Identity and rings

- An id is one uppercase letter and a positive integer: `A1`, `B14`. The letter is the ring (dte:B32).
- Numbers within a ring are allocated upward and **never reused**. `dte next <ring>` counts the tree, the ledger, and every branch git knows about.
- The id is the file name, `decisions/<ring>/<ID>.md`, and the frontmatter `id:`.
- Every leaf also carries a **uuid**, a time-ordered UUIDv7. The id is what people cite; the uuid says which leaf an id means when two branches minted the same number. A renumbered leaf keeps its uuid (dte:B58).
- A name is a handle, never a second identity: the tool resolves only ids. A leaf **moved** to another ring becomes a new leaf with a new id and uuid; the old one retires through the ledger and every citation and child follows.
- A long-lived specialized branch keeps its own subtree, rooted at an A leaf that carries `branch: <name>` and inherited by everything under it. It lives only on that branch, its findings reach other branches as ported changes, and its leaves' departure from another branch is not a deletion (dte:B54).

## 4. What a leaf is

A leaf records a call a person could weigh and choose otherwise, in the project's plain words. Anything describing how the code carries a call out (call order, wrappers, file formats, internal names) is spec content, fluid, with git as its record. The tripwire: a Decision names the call and its opposite, and a sentence that would still be true had the opposite been chosen belongs in the spec (dte:B47).

A leaf is kept for a call with stakes: a product call, or a technical call whose flip would change what the project's users get, cost real rework, or that the owner wants settled. A description of how a system works, and a technical choice an agent could flip without anyone outside the code noticing, are spec content even when a person could weigh them. The tripwire: would the owner want to be asked before this flips? A non-trivial choice without stakes is recorded in the spec it changes (dte:B63, dte:B8).

A part of a spec that must stop being fluid becomes a leaf, and the spec cites the leaf at that point instead of restating it. A spec has no other way to freeze text. Freezing is the owner's call; an agent proposes the leaf through the inbox, and once ratified the leaf is human-held (dte:B64).

Each leaf states one whole decision: read alone, its Decision says what is chosen, fully enough to ratify without opening any child. A child decides a different question that its parent leaves open and could be flipped while the parent stands. A leaf that finishes its parent (fills in what the parent gestures at, supplies its numbers or cases, restates or details it, names one aspect of it) folds back into the parent, or becomes spec. Two tests: hide the child, and if the parent stops saying something whole, fold; flip the child, and if the parent goes false or empty, fold. One leaf may govern several things when turning it off for one would break the others; a leaf holding two calls that could be flipped separately splits; things that were ever reversed independently stay separate (dte:B48).

A designed exception to a rule is the rule's child, with a "Removed by:" line naming the condition that would remove it; an exception nothing could remove means the rule was written wrong. A settled rule may carry a "Reopen if:" line (dte:B35).

Every document that describes how the system works is a leaf or a spec. An adopter's existing mechanics docs are its spec layer, declared in the `specs` globs, one per subsystem; a rationale doc (out-of-scope lists, deferrals) is a set of unlifted leaves. Proposals (the inbox), history (git) and reader on-ramps (a glossary, a mental model) are exempt (dte:B51).

## 5. Leaf format

A leaf is a markdown file with frontmatter in a restricted YAML subset: scalars, inline lists `[a, b]`, and block lists (C1). Its frontmatter holds only what no other record holds (dte:B43):

```yaml
---
id: B3
uuid: 01a05f6a-5803-7151-84ae-6f4c191d8679
title: "Artifacts cite decisions with a dte:ID token"   # free text is double-quoted
status: proposed          # only when not active: proposed | superseded | reverted (keep mode)
parents: [A1, A2]         # required unless ring A; each strictly shallower
branch: bleeding-edge     # only on the root of a branch-local subtree (B54)
made_by: human            # only when not ai: human | joint
date: 2026-09-02
ratified_by:              # the human who settled an ai or joint leaf
authorized_by:            # a human's go-ahead to change a human-held leaf
contested_by:             # who ran this leaf's one contest while unratified (B60)
conflicts_with: [C9]      # only when it lists something
aliases: [citationToken]  # the leaf's name, and nothing else
---
```

Provenance is `date` and `ratified_by` on every leaf, with `made_by` written only when a human, or a human with an agent, made it; absent, it reads as `ai`. Who wrote a leaf is git's record: the tool writes no `by`, and reads one an import carries (dte:B59). What a leaf superseded is the ledger's fact, not a field. Under `retire = keep` a retired file carries `status` and `superseded_by`, because there the file is the record. With `links = wikilink` the link fields are written as quoted wikilinks, `parents: ["[[A1]]", "[[A2]]"]`; both spellings are always read. Obsidian's `tags` and `cssclasses` are known keys, `null` and `~` read as empty, and dot-directories under `decisions/` are skipped, so the directory opens as a vault (dte:B30). `dte upgrade` brings a 0.1 leaf to this shape.

Body sections, in this order. Only **Decision** and **Why** are required, and no section is left empty.

```
## Decision
One or two sentences: the call, stated so it can be cited.

## Why
The plain reason, one or two sentences a person would say. It may lean on
the parent and never runs uphill (B40). If a concrete incident forced the
decision, the first sentence says so; a Why with none is preventive
judgment, the thinner claim in a contest. If the writer was guessing the
owner's preference, it says so.

## Consequences
What this makes true for the rings below and for artifacts, in this leaf's
own terms. A MUST that no test enforces carries an *Unenforced:* line.

## Alternatives considered
Optional. A terse list of the other ways this could have gone. It stays.

## Contest
Optional. The one contest's rubric, cases, costs and verdict (B60). Ratify
drops it.

## History
Optional. One line per event: created, moved, reworded, contested, ratified.
Ratify drops it too; History restarts at the ratification (B62).
```

A ratified leaf is present governance: what stands, why, and what it makes true. The owner may rewrite it in their own voice; git keeps everything before (dte:B62).

A leaf maps onto an Architecture Decision Record: MADR's *Context and Problem Statement* and *Decision Drivers* are the Why, *Decision Outcome* the Decision, *Consequences* the Consequences, *Considered Options* the Alternatives considered, and *decision-makers* is the commit author plus `ratified_by`. MADR's *Confirmation* has no field: confirmation is derived from citing tests. What a leaf has that MADR does not: ring, parents, uuid, the ledger, the one contest.

## 6. Citations

- Token: `dte:` followed by one or more comma-separated ids, `dte:ZZ1` or `dte:ZZ1,ZZ2`. Wikilink: `[[ZZ1]]` or `[[ZZ1|text]]`. Both are read everywhere; `links` picks the one the tool writes (dte:B3, dte:B30). Examples use the two-letter placeholder ring `ZZ`, which is never an id.
- A citation in a comment near the top says why the file exists; one beside a block says why that block does. A citation may be followed by the leaf's name for the reader, `dte:ZZ1 shareImpl`; the tool counts only the id.
- A citation replaces the comment that held the reason: WHY prose moves to the leaf, HOW prose to a spec, and a code comment says WHAT the block is and does.
- Citing a leaf cites its ancestry. Cite the most specific leaf.
- A spec may declare its scope with `covers: <globs>` in a comment line near its top. Every file the globs match is built to the spec and counts as citing what the spec cites; a rule about a whole class of files reaches the class through its spec instead of a citation in every member (dte:B44).
- Citing an unknown or retired id is an error.
- A leaf's lineage is its `parents:`. A leaf's Decision, Why and Consequences cite only shallower rings; History may name anything (dte:B49).

## 7. Rules

- **R1 (dte:B10)** Every non-core leaf has at least one parent. Core leaves have none. Every parent is strictly shallower.
- **R2 (dte:B4)** Two in-effect leaves that contradict are resolved by ring: shallower wins. A same-ring contradiction is an error, and usually means a refinement was filed as a sibling (dte:B35).
- **R3 (dte:B24)** A leaf is retired only through the ledger. In delete mode the file is removed and git keeps the text; in keep mode the file stays with a status. A deleted or renamed leaf file with no ledger line is an error, unless its uuid lives on under another id (a renumber) or it belongs to another branch's subtree. Retired numbers are never reissued.
- **R4 (dte:B24)** An in-effect leaf whose parent is retired is an **orphan**, and an error. This is how A1 is enforced: retiring a leaf forces its blast radius to be dealt with.
- **R5 (dte:B59)** Every leaf records its `date` and uuid; git records who wrote it. AI and joint leaves may be in effect unratified, so agents are not blocked, and validate surfaces every unratified leaf until a human ratifies it: it names those in rings A and B and counts the rest. A decision nobody remembers making is reconstructed as an AI leaf whose Why says it is inferred and from what.
- **R6 (dte:B61)** A hand edit to a leaf's body adds a History line, or a wording-only sweep is logged once in `decisions/EDITORIAL`. Validate warns on a body change neither covers.
- **R7 (dte:B11)** A human-held leaf that is superseded, reverted, moved or re-parented carries `authorized_by` naming a human. Off with `protect_human = off`.
- **R8 (dte:A6, dte:B15)** An agent never places or alters a leaf shallower than its ring. It writes the decision to the inbox and asks. `validate --as <ring>` enforces this on the agent's changed files, and warns when leaves changed with no ring declared (dte:B52).
- **R9 (dte:A5)** A model refers to a decision as `ID name`, adding the title when the reader needs it, never a bare id.
- **R10 (dte:B45)** The goal is total coverage. Every artifact cites a leaf, is built to a spec that does, or is listed in `.dtecoverage` under a `why:` line saying why it needs none. Coverage is reported as three gauges, one per hop: artifacts, specs, MUSTs. It is not an error; `coverage --check` makes it a gate for a project that wants one.
- **R11 (dte:B46)** A MUST is cited by the test that enforces it, or its Consequences carry an `*Unenforced:*` line saying why no test can. Validate warns on one that is neither.
- **R12 (dte:B53)** When the environment refuses an edit to the tree, the agent stops that change and asks the owner for an authorization naming the leaves. It never routes around the refusal.

## 8. Operations

Frontmatter is never hand-edited (dte:B29). Each operation below is one command; `specs/commands.md` and `specs/retiring.md` hold what each does in full.

**Add a decision.** `dte new <ring> --name camelCase --title "..." --by <name> --parents A1 [--decision "..." --why "..." | --body-file LEAF.md]`. Test it first (section 4). Cite it from what it produces, then validate.

**Import a corpus (dte:B33).** `dte import <dir> --by <who>` lifts one markdown file per leaf, properties unchanged, ids allocated parent-first. The History line `imported from <source>` marks re-homed content.

**Supersede.** Write the new leaf, read `dte blast OLD`, then `dte retire OLD --by <name> --superseded-by NEW [--authorized-by <human>]`. Every citation of OLD, in artifacts and in leaf bodies outside History, becomes NEW, with NEW's name where OLD's followed it; a line that ends up citing NEW twice keeps one. Children follow. A contest travels to NEW only when that contest produced NEW.

**Revert.** `dte retire OLD --by <name> [--authorized-by <human>]` with no successor. Citations and children of OLD now fail validation: that list is the revert's blast radius. Fix each child with `dte reparent` or retire it; re-point or remove each citation.

**Move.** `dte move <ID> <ring> --by <name> [--parents ...] [--authorized-by <human>]` writes the leaf at the new ring with a new id and uuid, keeps the parents still shallower (naming every one it drops), retires the old as `moved`, and rewrites every reference. Moving changes precedence: run `dte conflicts` after.

**Fold (dte:B48).** `dte fold <ID> [--into PARENT] --by <name>` takes an aspect back into its parent: its Decision and Consequences become the parent's Consequences, its citations and children move to the parent, and the ledger records `folded`.

**To spec (dte:B47).** `dte to-spec <ID> <spec> --by <name>` turns mechanics into spec text: the leaf's Decision and Consequences go into the spec under its title, the spec cites the leaf's parents, citations and children move to those parents, and the ledger records `to-spec` with the spec's path.

**Renumber and merge (dte:B58).** `dte renumber <ID> --by <name>` gives a leaf a fresh number and keeps its uuid. `dte merge-ids <base> --by <name>`, run on a branch before it merges into or rebases onto `base`, renumbers every leaf here whose id the base gives to another.

**Set a field.** `dte set <ID> title|name <value> --by <name> [--authorized-by <human>]` is the one generic frontmatter write. Every other field belongs to the command that owns its invariant, and `set` names it when refused. Provenance never changes after creation (dte:A3).

**Re-parent.** `dte reparent <ID> --parents ... --by <name> [--authorized-by <human>]` replaces a leaf's parents, orphan or not.

**Ratify.** `dte ratify <ID> --by <human>` sets `ratified_by`, makes a proposed leaf active, drops Contest and History, and logs one line. The leaf is human-held from then on.

**Authorize.** `dte authorize <ID> --by <human> [--note ...]` records a human's go-ahead on a leaf that exists: `authorized_by` plus a History line. It is how the owner's in-chat word reaches a leaf (C21).

**Contest (dte:B60).** Before a tree agent first builds new work under an unratified leaf, it runs `dte contest <ID>`: the tool prints the leaf, its parents as the rubric, and four slots (keep, opposite, deletion, variant). The agent builds each far enough to scope its cost, judges them against the parents alone, and records the verdict with `--record`. Parents are read, never reopened; siblings are not touched; children and citing artifacts count for nothing. A non-keep winner is written and the loser retired in the same run with `--record --chosen variant --title ... --body-file ...`. A contested leaf is settled until a human ratifies it or an agent supersedes it; a second contest needs `--again`. Re-homing text that already governs built code (an import, a fold, a move into a spec) owes no contest, and a rewrite the owner directs settles the leaf.

**Wording sweep (dte:B61).** `dte editorial --by <name> --note "..." [--replace old=new ...] [--skip ID]` logs one line for a sweep instead of one History line per leaf; with `--replace` it does the sweep itself over every in-effect leaf's title and body, History kept.

**Declare a contradiction.** `dte conflict <A> <B>` writes `conflicts_with` on both and prints the winner by ring.

**Escalate (dte:B14).** A decision above your ring, or of unclear ring, goes to `decisions/inbox/<slug>.md` with `title`, optional `proposed_ring`, `ask`, `by`, `date`, candidate `parents`, and a Decision and Why. Say so in chat with the title. Validate prints PENDING PLACEMENT until someone with authority runs `dte place <slug> <ring> --by <name> [--parents ...]`. The placer does not thereby ratify.

**Outbox (dte:B31).** A human directs agents from the vault: a note in `decisions/outbox/`, a `ratify`, `retire`, `contest` or `ask` tag on a leaf, or a name typed into `ratified_by`. `dte outbox` lists each with the command that processes it; `--done <ID|slug>` clears it.

**Spec (dte:A8).** `dte spec <ID> [--out FILE]` renders a spec skeleton from a leaf and its subtree. The spec cites the leaf; the leaf never lists its specs. A spec opens by citing what it serves and states each rule plainly: one point per paragraph, every sentence readable alone, no history and no "you" (B55).

**Build to a spec (dte:B42).** `dte brief --builder <spec>` prints the builder rules and the spec. A builder builds exactly what the spec says, cites the ids it names, decides nothing, never reads `decisions/`, and when the spec is silent files `dte gap <spec> --title "..." --by <who>`. Whoever holds the spec answers there.

**Upgrade.** `dte upgrade` rewrites a 0.1 tree's frontmatter to section 5's shape, bodies untouched, uuids backfilled stably. It is idempotent.

## 9. Blast radius

For leaf X: its descendants by ring; every artifact line citing X or a descendant, and every file built to a citing spec through `covers:`; and every leaf X superseded, from the ledger, as candidates to return if X is reverted. `dte blast X` prints all of it. Read it before changing X.

## 10. Relationship to structural graphs (dte:A4)

A structural graph (dependencies, call graph, data flow, ownership) answers "what is connected to what". DTE answers "why does this exist and who decided". They are orthogonal axes over the same artifacts, joined by file path: `dte export` writes leaves, citations, ledger and inbox as one JSON document. Neither tool should grow to absorb the other.

## 11. Authority and agents (dte:A6, dte:B13, dte:B15, dte:B52)

Every agent has a ring. A top-level agent asks the owner its ring before tree work; until answered, and in a run nobody watches, it works at the ring the project names for that case. A spawning agent puts `dte brief <ring> [--under ID]` at the top of each subagent's instructions, one ring deeper (dte:B27). The agent:

- decides at its ring or deeper, and cites what it builds;
- writes anything shallower, or of unclear ring, to the inbox and asks;
- stops and asks when its environment refuses a tree edit (dte:B53);
- runs `dte validate --as <ring>` before finishing.

The advisory map in `dte.cfg` (`authority = A:human, B:orchestrator, C+:subagent`) says who holds each ring, so "ask upward" has an addressee. It binds agents, never humans. What each ring means beyond A is the adopter's map.

The agent protocol DTE ships is `PROTOCOL.md`, free of this repository's specifics. `dte vendor --from <checkout>` copies it, this spec, the adoption guide, the walkthrough and a render of DTE's own decisions into an ignored directory, and names the A and B leaves added or retired since the last copy (B56).

## 12. Configuration (dte:B12)

`dte.cfg` at the project root, `key = value` per line, `#` comments. `dte init` writes every key with its default.

| key | default | meaning |
|---|---|---|
| `summaries` | `on` | print `ID name: title`; `off` prints bare ids (A5) |
| `protect_human` | `on` | enforce R7 (B11) |
| `authority` | none | advisory ring-to-holder map (B13) |
| `decisions` | `decisions` | where the tree lives, relative to the root |
| `retire` | `delete` | `delete` removes retired files (needs git); `keep` sets a status (B24) |
| `links` | `token` | `token` writes `dte:ID`; `wikilink` writes `[[ID]]` (B30) |
| `must_test` | `on` | warn on a MUST neither tested nor labeled (B46) |
| `specs`, `tests`, `agents`, `docs` | see `init` | globs for the layers below the tree; `show` derives per-layer lists; docs are not reach |
| `broad_fraction`, `broad_min` | `0.3`, `5` | thresholds for the broad scope finding (B21) |
| `scan_self` | `off` | scan the running tool file; only DTE's own repo sets it |

`.dteignore` lists globs the scanner skips. `.dtecoverage` lists files that need no decision, grouped under `why:` lines (B45).

## 13. Scope checks and layers (dte:B21, dte:B37)

The tree holds why. Below it, artifacts are told apart by the layer globs: specs (what to build), tests (what enforces), agents (instruction files that carry process rules), docs (what describes), and everything else is code. A leaf stores none of this; `show` derives each list from citations at read time.

`dte scope` is advisory and never fails. It reports a non-core leaf with **no reach**; a **broad** leaf whose reach rivals the core's; a **skipped ring**, a parent more than one ring shallower, unless the parent or the leaf is human-held; and **core-only code**, an implementing line citing ring A. `scope --comments` lists comment-heavy files with no citation, where a WHY may still live.

## 14. Tooling contract (dte:B6)

A conforming tool is a single file with no dependencies beyond the language runtime. It implements asking the tree (`show`, `find`, `tree`, `blast`, `trace`, `conflicts`, `coverage`, `scope`, `unratified`, `retired`, `authority`, `next`), changing it (`new`, `import`, `place`, `cite`, `set`, `reparent`, `ratify`, `authorize`, `contest`, `conflict`, `retire`, `move`, `fold`, `to-spec`, `renumber`, `merge-ids`, `editorial`, `inbox`, `outbox`), agents and specs (`brief`, `brief --builder`, `spec`, `gap`), and integration (`validate`, `export`, `init`, `upgrade`, `vendor`, `hook`). Every output that names a leaf prints `ID name: title` unless summaries are off. The exit code is non-zero when `validate` finds errors. The reference implementation is `tools/dte.py`.

## 15. Open questions

- Whether a leaf may name a deeper ring for a "supporting" link. Current answer: no; the child says how it follows (B49).
- Rings beyond `Z`. Current answer: if you need 27 rings, the core is wrong.
- Whether citations should carry a reason string. Deferred.
- License for this repository. The owner's decision.
