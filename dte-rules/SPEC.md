<!-- vendored from DTE 3050da4 on 2026-09-18. Do not edit; refresh with: python tools/dte.py vendor --from <your DTE checkout> -->

<!-- dte:A1,A2,A3,A4,A5,A6,B1,B3,B4,B24,B7,B10,B11,B12,B13,B14,B15,B16,B21,B32,B29,B27,B30,B31,C19,B33,B34,B35,B36,B37,C20,C21,C22,C23,C24 -->
# DTE Specification (v0)

This document is normative. Words in **bold** are defined terms. Each section cites the decision it derives from; the decision file holds the rationale.

## 1. Premise

Nothing in a project can exist without a decision having been made (dte:A2). Some decisions are made by humans, some by AI, some jointly (dte:A3). DTE records the decisions as a tree of **rings** and links every **artifact** to the decisions it serves, so that the **blast radius** of changing any decision is knowable (dte:A1).

DTE is not a dependency graph. It records *why*, not *what calls what* (dte:A4, dte:B9).

## 2. Vocabulary

- **Decision**: a choice that caused something to exist or be shaped a certain way. Recorded as a **node**.
- **Node**: one markdown file describing one decision (dte:B1).
- **Ring** (or **layer**): the depth of a node from the core. Ring 0 is `A`, ring 1 is `B`, and so on (dte:B32).
- **Core**: the `A` ring. The abstract goals of the project. Core nodes have no parents (dte:B10).
- **Parent**: a node this node exists *because of*. Parents are always in a strictly shallower ring (dte:B10).
- **Artifact**: any file in the project that is not a node: code, config, docs, tests, data.
- **Citation**: the token `dte:ID` placed in an artifact, meaning "this exists because of ID" (dte:B3).
- **Blast radius** of a node: every node that descends from it, every artifact that cites it or any descendant, and every node it currently supersedes (dte:C2).
- **Precedence**: when two active nodes contradict, the one in the shallower ring wins (dte:B4).
- **Provenance**: who made the decision: `human`, `ai`, or `joint` (dte:B7).
- **Human-held**: a node made by a human, or ratified by one (dte:B11).
- **Authority**: the ring an agent operates at. It decides at that ring or deeper and asks upward for anything shallower (dte:A6).
- **Inbox**: where a decision waits, without an ID, until someone with authority places it in a ring (dte:B14).
- **Outbox**: the human-to-agent channel: a note in `decisions/outbox/`, an action tag on a node, or a `ratified_by` typed in by hand (dte:B31).
- **Name**: the node's camelCase handle, unique among in-effect nodes, which always accompanies its ID when a model refers to it (dte:A5, dte:B32). **Title** is the one-sentence description behind it (dte:B16).
- **Ledger**: `decisions/RETIRED`, one line per retired node. Burns the number for ever and records who retired it (dte:B24, dte:C11).

## 3. Identity and rings (dte:B32)

- An ID is one uppercase letter followed by a positive integer: `A1`, `B14`, `C3`. The letter is the ring. `A` is the core.
- Numbers within a ring are allocated upward and **never reused**, even after a node is moved or reverted. `dte next <ring>` gives the next free number, counting the tree, the ledger, and every branch git knows about (dte:C15).
- The ID appears in the frontmatter `id:` field and is the file name: `decisions/<ring>/<ID>.md`.
- A `name` is a handle, never a second identity: the tool resolves only IDs (dte:B32). A node **moved** to another ring becomes a new node with a new ID there; the old node stays as a file, `superseded` by the new one, and every citation and child is rewritten in the same change (see section 7). The old file is deleted or kept per `retire` in `dte.cfg`; either way the ledger records it and the number is burned.

## 4. Node format (dte:B1, dte:B7)

A node is a markdown file with YAML frontmatter. Only the subset of YAML shown here is supported (dte:C1): scalars, inline lists `[a, b]`, and block lists.

```yaml
---
id: B3
name: citationToken       # camelCase handle, unique; the chat form beside the ID (dte:B32)
title: "Artifacts cite decisions with a dte: token"   # free text is double-quoted (dte:B30)
status: active            # proposed | active | superseded | reverted
parents: [A1, A2]         # required unless ring A; each must be shallower
supersedes: []            # nodes this one replaces (they become superseded)
superseded_by:            # set when status is superseded
conflicts_with: []        # active nodes this one contradicts (resolved by ring)
made_by: ai               # human | ai | joint
by: Claude Fable 5.1      # person or model, free text
date: 2026-09-02
ratified_by:              # human who confirmed an ai/joint decision (optional)
authorized_by:            # human who authorised retiring/moving a human-held node
contested_by:             # who ran this node's one contest while unratified (dte:B28)
confidence: high          # low | medium | high (optional)
aliases: [citationToken]  # written by the tool from name so [[name]] resolves in Obsidian
---
```

`name` is the handle a model says beside the ID (dte:A5, dte:B32); `title` is the description. Write the title as the decision in one sentence, under 100 characters (dte:B16).

With `links = wikilink` (dte:B30) the link fields are written as quoted wikilinks, `parents: ["[[A1]]", "[[A2]]"]`, so Obsidian draws them as edges; the tool reads both spellings whatever the setting. `tags` and `cssclasses` are accepted as Obsidian's own keys; `null` and `~` read as empty; `aliases` must equal `[name]` (dte:B32). Dot-directories under `decisions/` (`.obsidian`) are ignored, so the directory opens as a vault.

Body sections, in this order. Only **Decision** and **Why** are required.

```
## Decision
One or two sentences. The thing that was decided, stated so it can be cited.

## Why
The reasoning only: what the parents demanded, what was traded off. No
dates, no account of who said what when; history that matters is a History
line (dte:B41). If a concrete incident forced this decision, say so in the
first sentence; there is no field for it (dte:B40). A Why with no incident is preventive judgment, and a
contest weighs it as the thinner claim.

## Consequences
What this makes true for the rings below and for artifacts.

## Alternatives considered
Optional. A terse list of the other ways this could have gone, one line
each. It stays; it is part of what the decision means.

## Contest
Optional. A contest (dte:B28) records its rubric, the keep, opposite,
deletion and variant cases with their scoped costs, and the verdict here.
It informs the ratification and `ratify` deletes it (dte:B41); git keeps
the text.

## History
Optional. One line per event: created, ratified, moved, reworded,
contested. Nothing else: a node is present governance, not a dev log
(dte:B41).
```

### Relationship to ADR and MADR

A node is an Architecture Decision Record with more structure. Against the MADR template (adr.github.io/madr, version 4): its *Context and Problem Statement* and *Decision Drivers* are the Why; *Decision Outcome* is the Decision; its *Consequences* subsection is Consequences; *Considered Options* and *Pros and Cons of the Options* are Alternatives considered; `status: superseded by ADR-NNNN` is `superseded_by`; `decision-makers` is `by` plus `ratified_by`. MADR's *Confirmation* subsection has no field here: confirmation is derived from citing tests (dte:B37). What a node has that MADR does not: `ring`, `parents`, `made_by`, `contested_by`, the ledger. The mapping is declared so a reader who knows ADRs can read a tree; the tool does not export MADR files.

### Status semantics (dte:C5)

| status       | in effect?         | meaning                                             |
|--------------|--------------------|-----------------------------------------------------|
| `proposed`   | yes, provisionally | made but not yet confirmed. Children get a warning. |
| `active`     | yes                | the normal state.                                   |
| `superseded` | no                 | replaced by `superseded_by`. File is kept.          |
| `reverted`   | no                 | withdrawn with no replacement. File is kept.        |

## 5. Citations (dte:B3)

- Token: `dte:` immediately followed by one or more IDs separated by commas. Examples: `dte:B3`, `dte:B6,C1`. Case-sensitive. No spaces before the ID.
- Wikilink: `[[B3]]` or `[[B3|text]]` is the same citation in Obsidian's spelling (dte:B30, dte:C19). Both forms are read everywhere; `links` in `dte.cfg` picks which one the tool writes.
- Examples in prose use the placeholder ring `ZZ`: `dte:ZZ1`, `[[ZZ1]]`. Two letters is not an ID shape, so it is never a citation and never an error.
- Place it in a comment for code, or in prose or an HTML comment for docs. A file-level citation at the top says why the file exists. Line-level citations say why a specific block exists.
- A citation replaces the comment that held the reason (dte:B38). WHY prose lives in the node, HOW prose in a spec, and a code comment says WHAT the block is and does. The tool's `scope --comments` lists comment-heavy files with no citation as migration candidates.
- Citing a node implicitly cites its whole ancestry. Cite the *most specific* node that explains the artifact. Citing an `A` node directly is allowed and means "this exists straight from the core goal".
- Citing an unknown ID is an error. Citing a superseded or reverted node is a warning: the artifact was built under a decision that no longer stands.
- Nodes do not use citation tokens for lineage; they use `parents:`. A `[[ID]]` in a node's prose is a link for the reader, not lineage.

## 6. Rules

- **R1 (dte:B10)** Every non-core node has at least one parent. Core nodes have none. Every parent is in a strictly shallower ring.
- **R2 (dte:B4)** Two active nodes that contradict each other are resolved by ring: shallower wins. Two contradicting nodes in the *same* ring are an error; resolve by superseding one or moving one. A node that narrows, excepts or supports another belongs below it as a child (dte:B35): a same-ring contradiction usually means a refinement was filed as a sibling.
- **R3 (dte:B24, dte:C11)** A node is retired only through the ledger. In delete mode the file is removed and git keeps the text; in keep mode the file stays with `status` set. A deleted node file with no ledger line, or a renamed node file, is an error. Retired numbers are never reissued.
- **R4 (dte:B24)** An in-effect node whose parent is retired is an **orphan**. Orphans are errors: re-parent, supersede, or revert them. This is how A1 is enforced: reverting a node forces its blast radius to be dealt with, not forgotten.
- **R5 (dte:B7)** Every node records `made_by` and `by`. AI-made nodes may be `active` without ratification so agents are not blocked, but tools surface every unratified AI node until a human sets `ratified_by`. A decision nobody remembers making is reconstructed as `made_by: ai`, low confidence (dte:B34). A hand edit to a body adds a History line; validate flags a body change without one (dte:B36).
- **R6 (dte:A2)** The goal is total coverage: every artifact cites at least one node. Coverage below 100% is not an error (adoption is incremental, dte:B22) but it is always reported.
- **R7 (dte:B11)** A human-held node that is superseded, reverted, or moved must carry `authorized_by` naming a human. Off with `protect_human = off`.
- **R8 (dte:A6, dte:B15)** An agent never places or alters a node shallower than its ring. It writes the decision to the inbox and asks. With `--as <ring>`, validate enforces this on the agent's changed files.
- **R9 (dte:A5)** A model refers to a decision as `ID name`, adding the title when the reader needs it, never bare ID, unless `summaries = off`.

## 7. Operations

**Add a decision.** `dte new <ring> --name camelCase --title "..." --by <name> --parents A1 [--decision "..." --why "..." | --body-file NODE.md]`. The tool allocates the ID and writes the node; unfilled sections are `TODO` and validate warns until they are written. `--body-file` takes the sections verbatim (dte:C20). Cite it from the artifacts it produces. Run `dte validate`. Frontmatter is never hand-edited (dte:B29).

**Import an existing corpus (dte:B33, dte:C20).** `dte import <dir> --by <who>` lifts one markdown file per node: frontmatter `ring`, `title`, optional `name`, `parents` (ids, names, or other files in the batch by name) and any node property the source already carries, all written unchanged; the body verbatim. IDs are allocated parent-first. Each node gets one History line, `imported from <source>`, and that line is the mark: an imported node is re-homed content, not a new decision, and owes its contest before the first new work under it, not at import.

**Supersede.** Write the new node. Run `dte blast OLD`. Then `dte retire OLD --by <name> --superseded-by NEW [--authorized-by <human>]`: the tool adds OLD to NEW's `supersedes`, rewrites every citation and child of OLD to NEW and prints them for review (they were built under OLD), writes the ledger line, and deletes or keeps the file per `retire`.

**Revert.** `dte retire OLD --by <name> [--authorized-by <human>]` with no successor. Citations and children of OLD are left as they are and now fail validation with a hint: that list is the blast radius of the revert. Each orphaned child is fixed with `dte reparent <ID> --parents ... --by <name>` or retired; each citation is re-pointed with `dte cite` or removed. Nodes OLD had superseded are printed as candidates to return.

**Move (promote or demote).** Moving changes precedence (dte:A1, dte:B32). A move is a supersession with the same text at a different ring. Use `dte move <ID> <ring> --by <name> [--parents ...] [--authorized-by <human>]`, which does all of the following in one run (dte:C9):
1. Refuses if a child would not be strictly deeper than the new ring: move or re-parent the child first. Refuses a human-held node without `--authorized-by`.
2. Allocates the new ID and writes the new node with the old body, `supersedes: [OLD]`, and `ratified_by` cleared, because precedence changed.
3. Keeps the old parents that are still strictly shallower, or takes `--parents`. Every dropped parent is named: its blast radius shrank.
4. Retires the old node through the ledger: deleted in delete mode, kept with `status: superseded` in keep mode.
5. Rewrites `dte:OLD` in every artifact and `OLD` in every child's `parents`.
Then run `dte blast` on each dropped parent, and `dte conflicts` if the node has declared contradictions: promotion means it now wins ones it lost. Never `git mv` or hand-delete a node file; validation rejects renames and ledger-less deletions.

**Set a field (dte:B29, dte:C18).** `dte set <ID> title|name|confidence <value> --by <name> [--authorized-by <human>]` is the one generic frontmatter write, for the fields that carry no invariant (`name` is checked for shape and uniqueness and rewrites `aliases`). Every other field belongs to the command that owns its invariant, and `set` names that command when refused. Provenance fields are never changed after creation (dte:A3). The old value goes to History.

**Ratify.** `dte ratify <ID> --by <human>` sets `ratified_by`, flips `proposed` to `active`, drops `## Contest` and logs the drop in one History line (dte:B41). `## Alternatives considered` stays. A ratified node is human-held from then on (dte:B11). `validate` warns when a ratified node still carries a Contest section.

**Authorize (dte:C21).** `dte authorize <ID> --by <human> [--note ...]` records a human's go-ahead on a node that already exists: `authorized_by` plus a History line. It is how an owner's "go ahead" reaches a node an agent drafted above its ring, and the only writer of that field.

**Contest (dte:B28).** An unratified node is not a block, but before a tree agent first builds new work under it (a child, a spec, an artifact) the agent runs `dte contest <ID>` (dte:C17). An import owes none (dte:B33). The tool prints the node, its parents as the rubric, and four slots: keep, opposite, deletion, variant. The agent builds each alternative far enough to scope its cost, judges them against the parents alone, and records the verdict with `dte contest <ID> --record --chosen <slot> --by <name> --note "..."`. Parents are read, never reopened. Siblings are not touched. Children and citing artifacts count for nothing, not even as cost: a better node may need none of them. If keep did not win, the agent writes the winner with `new` and retires the loser, or does both in the same run with `--record --chosen variant --title ... --body-file ...` (dte:C22); a successor that carries the loser's contest is marked contested by it. A contested node is settled (dte:A7): it is acted on without re-asking until a human ratifies it or an agent supersedes it; a second contest needs `--again`. Ratification then reviews a comparison with costs, not a bare proposal.

**Declare a contradiction.** `dte conflict <A> <B>` writes `conflicts_with` on both nodes and prints the winner by ring (dte:B4).

**Escalate (dte:B14).** When a decision belongs above your ring, or you do not know where it belongs, write `decisions/inbox/<slug>.md`:

```yaml
---
title: One-sentence statement of the decision
proposed_ring: B          # your best guess, or omit
ask: orchestrator         # who should place it; defaults to the ring's holder
made_by: ai
by: <model>
date: 2026-09-02
parents: [A1]             # candidate parents, optional
---
## Decision
## Why
```

Then say so in chat, with the title. Validate and tree print PENDING PLACEMENT with the question to ask until it is placed.

**Outbox (dte:B31).** A human directs agents from inside the vault without the CLI: drop a note in `decisions/outbox/` (any shape; title from frontmatter, first heading, or file name), put `ratify`, `retire`, `contest` or `ask` in a node's `tags` property or inline as `#ask`, or type a name into `ratified_by`. `dte outbox` lists every item with the command that processes it; `dte outbox --done <ID|slug>` removes the note or strips the tags; `validate` prints `OUTBOX (n)` until the list is empty. A bare edit with no tag is not an outbox item: validate's changed-nodes list covers it.

**Place (dte:B14).** Someone with authority runs `dte place <slug> <ring> --by <name> [--parents A1,B2]`. The tool allocates the ID, writes the node into the ring with a History line, and removes the inbox file. The placer is not thereby ratifying the content; `ratified_by` stays empty until a human sets it.

**Authorise an override (dte:B11).** To retire or move a human-held node, a human sets `authorized_by:` on it. An AI may prepare the change but the field must name a person.

**Spec (dte:A8, dte:C26).** `dte spec <ID> [--out FILE]` renders a spec skeleton from a node: its citation at the top, its Decision as the purpose, its parents' Decisions and its Consequences as constraints, every descendant as a covered decision, and empty Requirements, Out of scope and Gaps. A tree agent fills it. The spec cites the node; the node never lists its specs (dte:B37).

**Build to a spec (dte:B42, dte:C27).** `dte brief --builder <spec>` prints the builder rules and the spec: build exactly what it says, cite the IDs it names, decide nothing, never read `decisions/`, and when the spec is silent stop and file `dte gap <spec> --title "..." --by <who>`. A gap is an inbox item with `kind: gap` naming the spec; `inbox` lists gaps apart from decisions, `place` refuses them, and whoever holds the spec answers in the spec and removes the file.

## 8. Blast radius (dte:C2)

For node X:

1. **Descendants**: every node with X in `parents`, transitively. Grouped by ring.
2. **Artifacts**: every file and line citing X or any descendant.
3. **Formerly superseded**: every node X supersedes. If X is reverted, those are candidates to come back.

`dte blast X` prints all three. Read it before changing X.

## 9. Relationship to graph engineering (dte:B9, dte:A4)

A structural graph (dependencies, call graph, data flow, module ownership) answers "what is connected to what". DTE answers "why does this exist and who decided". They are orthogonal axes over the same artifacts and they cross-reference:

- An artifact appears in both. Its graph edges say what it touches; its citations say what it serves.
- A DTE node may name graph elements in its Consequences section. A graph element may carry a citation.
- DTE does not model structural edges, and a graph does not model precedence or provenance. Neither tool should grow to absorb the other.

## 10. Authority and agents (dte:A6, dte:B13, dte:B15)

Every agent has a ring. A spawning agent puts the output of `dte brief <ring> [--under ID]` at the top of the subagent's instructions (dte:B27): the ring, the `DTE_RING` variable, whom to ask, the in-effect decisions above the ring that bind it, and the rules. The agent:

- makes decisions at its ring or deeper, and cites them;
- writes anything shallower, or of unclear ring, to the inbox and asks;
- runs `dte validate --as <ring>` before finishing, which fails if any node it changed is shallower than its ring or is human-held without `authorized_by`.

The advisory map in `dte.cfg` (`authority = A:human, B:orchestrator, C+:subagent`) says who holds each ring, so "ask upward" has an addressee. `dte authority` prints it. The map binds agents. It never binds humans, who may decide at any ring; a human-made node is valid anywhere.

## 11. Configuration (dte:B12)

`dte.cfg` at the project root, `key = value` per line, `#` comments.

| key             | default | meaning                                      |
|-----------------|---------|----------------------------------------------|
| `summaries`     | `on`    | print `ID name: title`; `off` prints bare IDs (A5) |
| `protect_human` | `on`    | enforce R7 (B11)                             |
| `authority`     | none    | advisory ring-to-holder map (B13)            |
| `docs`          | `*.md, docs/*` | describing artifacts; not counted as reach (C8) |
| `broad_fraction`| `0.3`   | share of nodes or artifacts that makes a node broad (C8) |
| `broad_min`     | `5`     | minimum count before the share is considered (C8) |
| `retire`        | `delete`| `delete` removes retired files (needs git); `keep` sets status (B24) |
| `specs`, `tests`, `agents` | see cfg | globs for the layers below the tree; `show` derives per-layer lists (B37, C24) |
| `scan_self`     | `off`   | scan the running tool file; only DTE's own repo sets it (C24) |
| `links`         | `token` | `token` writes `dte:ID`; `wikilink` writes `[[ID]]` for Obsidian (B30, C19) |

## 12. Scope checks and layers (dte:B21, dte:C8, dte:B37)

The tree holds why. Below it, artifacts are told apart by the `dte.cfg` globs: `specs` (what to build), `tests` (what enforces), `agents` (instruction files that carry process rules), `docs` (what describes), and everything else is code. A node stores none of this; `show` derives "specified by", "implemented by", "enforced by", "instructs" and "described by" from citations at read time, and `coverage` lists in-effect nodes with no citing test.

`dte scope` is advisory and never fails. It reports:

- **no reach**: a non-core node with no descendants and no citing spec, code, test or agent instruction. Describing documents (the `docs` globs) do not count. Retire it, or cite it from what it governs.
- **broad**: a non-core node whose descendants or implementing files are at least `broad_fraction` of the whole, with at least `broad_min` of them. Promote it, or split it into several decisions.
- **skipped ring**: a parent more than one ring shallower. A decision in the ring between is missing, or the node is at the wrong ring.
- **core-only code**: an implementing artifact line that cites ring A. No rule-level decision explains that line; add one, or cite something more specific.

The thresholds are guesses until calibrated on a large tree. Ring balance (equal depth everywhere) is deliberately not a check: not everything needs the same depth to be useful.

## 13. Tooling contract (dte:B6)

A conforming tool is a single file with no dependencies beyond the language runtime, and implements (dte:B29): asking the tree with `show`, `find`, `tree` (with `--under`), `blast`, `trace`, `conflicts`, `coverage`, `scope`, `retired`, `authority`, `next`, `brief` (dte:B27); changing it with `new`, `cite` (dte:C14), `ratify`, `conflict`, `reparent`, `set` (dte:C18), `contest` (dte:C17), `move`, `retire`, `inbox`, `outbox` (dte:B31), `place`, `import` (dte:C20), `authorize` (dte:C21), `unratified` (dte:C23), `spec` (dte:C26), `gap` and `brief --builder` (dte:C27); and `validate` (a summary by default, `--full` for the whole unratified list) (with `--as`, defaulting to `$DTE_RING`), `export` (JSON: nodes, citations, ledger, inbox; the join surface for structural tools, dte:C12), `init` (scaffold, dte:C13), `vendor` (copy DTE's rule text and a render of its decisions into an ignored directory, stamped with the source commit, dte:C25, dte:B39), and `hook` (pre-commit validate, dte:C14). Every output that names a node prints `ID name: title` unless summaries are off. The reference implementation is `tools/dte.py`. Exit code is non-zero when `validate` finds errors.

## 14. Open questions (not yet decided)

- Whether a node may have a parent in a *deeper* ring for "supporting" links. Current answer: no; use Consequences prose.
- Rings beyond `Z`. Current answer: if you need 27 rings, the core is wrong.
- Whether citations should carry a reason string. Deferred.
- License for this repo. Owner's decision.
