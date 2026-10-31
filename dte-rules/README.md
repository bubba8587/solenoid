<!-- vendored from DTE 0.2 (f4df54a) on 2026-10-31. Do not edit; refresh with: python tools/dte.py vendor --from <a DTE checkout> --dir dte-rules -->

<!-- dte:A1,A2,A3,A4,A5,A6,A7,A8,A9,B50 -->
# Decision Tree Engineering (DTE)

**Every thing in a project exists because a decision was made.** DTE makes that lineage explicit, ring by ring, so that when a decision changes you know exactly what it touches.

A project's decisions form a branching tree (dte:A9). The core is ring `A`, the project's goals. Each ring outward holds decisions made *because of* the ring inside it, so every decision, called a **leaf**, has parents in a shallower ring. Position is both authority and reach: the shallower ring wins a contradiction, and a change reaches everything below it. Code, config, docs and tests are the **artifacts**, and each one cites the leaves it exists to serve.

DTE works **alongside** structural methods such as graph engineering. A dependency graph tells you *what* touches *what*. The decision tree tells you *why* any of it is there, and who decided. It is traceability for rationale: from any decision to every spec, test, file and instruction that serves it, and back.

This is version 0.2, rebuilt from what a 200-leaf tree in a live product needed.

## The one rule that matters (A1 blastRadius)

> If a decision is changed or reverted in a project, it is possible to know exactly what layers that decision applies to and its blast radius. A decision can be moved up and down the hierarchy, which means that a superseding or contradictory goal always takes preference over the one that was moved down (or vice versa).

Everything else in this repo descends from that. See `decisions/A/A1.md`.

## Three layers (A8 threeLayers)

| Layer | Holds | Where |
|---|---|---|
| Leaves | **why**: goals, rules, calls, and who made them | `decisions/` |
| Specs | **what** to build, citing the leaves they serve | `specs/` |
| Code and tests | **how** | everywhere else |

A layer cites upward and stores nothing from below. A leaf never lists its specs, tests or files; the tool derives those lists from citations when you ask. A spec can say `covers: src/components/*` and every file it matches is built to it, so a rule about a whole class of files reaches the class through one spec instead of a citation in every file.

The line between a leaf and a spec is the one test DTE asks you to apply every time: **a leaf is a call a person could weigh and choose otherwise.** Name the call and its opposite. A sentence that would still be true had the opposite been chosen is mechanics, and mechanics are spec. When DTE ran that test over its own tree, 18 of its 24 tool leaves turned out to be mechanics and moved into `specs/`.

## How it looks

```
decisions/
  A/A1.md      ring A: core goals            (made by a human)
  B/B3.md      ring B: "cite decisions with a dte: token"   parents: [A1, A2]
  inbox/       agent -> human: decisions waiting to be placed, spec gaps
  outbox/      human -> agent: notes and tagged leaves
  RETIRED      ledger of retired ids; numbers are never reused
  EDITORIAL    one line per wording-only sweep
specs/         what to build; each spec cites the leaves it serves
tools/dte.py   # dte:B6   <- code cites the leaves it serves
.dtecoverage   files that need no decision, each group under the reason why
```

A leaf is a markdown file. Its frontmatter is written by the tool, never by hand, and holds only what no other record holds:

```yaml
---
id: B3
uuid: 01a05f6a-5803-7151-84ae-6f4c191d8679   # tells two branches' B3s apart
title: "Artifacts cite decisions with a dte:ID token"
parents: [A1, A2]         # must be in shallower rings; ["[[A1]]", "[[A2]]"] in wikilink form
date: 2026-09-02
ratified_by:              # a human's name here settles the leaf
aliases: [citationToken]  # its name: chat says "B3 citationToken"
---
```

The body is a Decision (one or two citable sentences), a Why (the plain reason and nothing else), Consequences, and a History of one line per event. Ratifying drops the History; git keeps it.

Any artifact cites a leaf with `dte:ID` in a comment or in prose, or as `[[ID]]` when `links = wikilink` is set; `decisions/` then opens directly as an Obsidian vault with lineage as graph edges.

## The tool

```
# ask the tree
python tools/dte.py show B3           # one leaf: lineage, children, citing lines, body
python tools/dte.py find "alias"      # search ids, names, titles, bodies, ledger, inbox
python tools/dte.py tree [--under B3] # the whole tree ring by ring, or one subtree
python tools/dte.py blast B3          # what would changing B3 touch?
python tools/dte.py trace tools/dte.py   # why does this file exist?
python tools/dte.py coverage          # three gauges: artifacts, specs, MUSTs
python tools/dte.py scope             # advisory: dead leaves, over-broad leaves, skipped rings
python tools/dte.py unratified        # shallowest and widest first

# change the tree
python tools/dte.py new C --name scannerWalk --title "..." --by agent --parents B3 --decision "..." --why "..."
python tools/dte.py cite src/thing.py C3        # insert the citation in the file's comment syntax
python tools/dte.py ratify B3 B4 --by owner
python tools/dte.py contest B3                  # one contest per unratified leaf
python tools/dte.py retire B5 --by owner --superseded-by B24
python tools/dte.py move C4 B --by owner        # promote: new id, old retired, references rewritten
python tools/dte.py fold C7 --by agent          # an aspect goes back into its parent
python tools/dte.py to-spec C9 specs/x.md --by agent   # mechanics become spec text
python tools/dte.py merge-ids main --by agent   # before merging: renumber what main gave another leaf
python tools/dte.py editorial --by agent --note "..." --replace old=new   # one log line for a sweep

# specs and agents
python tools/dte.py brief C --under B3          # the block to hand a subagent at ring C
python tools/dte.py spec B3 --out specs/b3.md   # a spec skeleton from a leaf
python tools/dte.py brief --builder specs/b3.md # the block to hand a builder: spec only
python tools/dte.py gap specs/b3.md --title "..." --by builder

# check and integrate
python tools/dte.py validate --as C   # consistency; as an agent at ring C, did I overstep?
python tools/dte.py export --out tree.json
python tools/dte.py init / upgrade / vendor --from ../DTE / hook
```

Three rules the tool enforces:

- **Authority follows ring** (A6 authorityByRing). An agent decides at its ring or deeper. Anything shallower goes to `decisions/inbox/` without an id until a person or a higher agent places it.
- **Human-held decisions are protected** (B11 humanHeldProtected). A leaf a human made or ratified cannot be superseded, reverted, moved or re-parented without `authorized_by` naming a human.
- **Nothing vanishes** (B24 retiredLedger). A leaf leaves through the tool, which writes the ledger and rewrites every reference, names included. A leaf file deleted by hand fails validation.

The tool is one file with no dependencies (Python 3.8+). Copy it into any project. Its tests run with `python -m unittest discover -s tests`.

## Working with agents

DTE exists so agents can work autonomously and indefinitely without re-asking what is already decided (A7 autonomy). `PROTOCOL.md` is the protocol an agent loads in any DTE repo:

- **Ask your ring.** An agent asks the owner its ring before tree work, and briefs each subagent one ring deeper with `dte brief`. A *builder* holds no ring and never reads the tree: it gets a spec, builds exactly that, and files a gap when the spec is silent.
- **One contest, then settled.** Before the first new work under an unratified leaf, a tree agent contests it once (keep, opposite, deletion, maybe a variant) judged against its parents alone, and records the verdict.
- **Say the name, name the leaf.** A decision is always referred to by id *and* name, never a bare "A4" (A5 idPlusName). A report that something was built names the leaf that governs it.
- **A refusal stops the agent.** When the environment refuses an edit to the tree, the agent asks the owner and never routes around it.

The human answers through the same tree: ratify a leaf, tag it, or drop a note in `decisions/outbox/`.

DTE defines none of the process around the tree. Triage, backlog, release habits and house voice are the adopter's own.

## Read next

- `SPEC.md` for the normative rules, and `specs/` for how the reference tool carries them out.
- `PROTOCOL.md` for how AI agents behave in a DTE repo.
- `WALKTHROUGH.md` for the whole life cycle on a toy project, real output.
- `ADOPTING.md` for bringing DTE into an existing project, or upgrading from 0.1.
- `decisions/` for this repo's own tree. DTE is built with DTE: every change is a leaf first, then the tool, then the docs (A9 treeStructure).

## Status

Ring A is set by the project owner. Rings B and C are in effect and being ratified one leaf at a time; `python tools/dte.py unratified` has the live list, widest first. The goal is a finished package other repos and agents install in one step (dte:A4).
