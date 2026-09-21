<!-- vendored from DTE 3050da4 on 2026-09-18. Do not edit; refresh with: python tools/dte.py vendor --from <your DTE checkout> -->

<!-- dte:A1,A2,A3,A4,A5,A6,A7,A8,A9 -->
# Decision Tree Engineering (DTE)

**Every thing in a project exists because a decision was made.** DTE makes that lineage explicit, ring by ring, so that when a decision changes you know exactly what it touches.

A project's decisions form a branching tree (dte:A9). The core is ring `A`, the project's goals. Each ring outward holds decisions made *because of* the ring inside it, so every node has parents in a shallower ring. Position is both authority and reach: the shallower ring wins a contradiction, and a change reaches everything below it. Code, config, docs and tests are the leaves and bark. Each one cites the decision(s) it exists to serve.

DTE works **alongside** structural methods such as graph engineering. A dependency graph tells you *what* touches *what*. The decision tree tells you *why* any of it is there, and who decided. It is traceability for rationale: from any decision to every spec, test, file and instruction that serves it, and back.

## The one rule that matters (A1 blastRadius)

> If a decision is changed or reverted in a project, it is possible to know exactly what layers that decision applies to and its blast radius. A decision can be moved up and down the hierarchy, which means that a superseding or contradictory goal always takes preference over the one that was moved down (or vice versa).

Everything else in this repo descends from that. See `decisions/A/A1.md`.

## Three layers (A8 threeLayers)

| Layer | Holds | Where |
|---|---|---|
| Decisions | **why**: goals, rules, choices, and who made them | `decisions/` |
| Specs | **what** to build, generated from the tree and citing the nodes they serve | `specs/` |
| Code and tests | **how** | everywhere else |

A layer cites upward and stores nothing from below. A node never lists its specs, tests or files; the tool derives those lists from citations when you ask (dte:B37). Comments follow the same split: the why moves to a node, the how to a spec, and only the what stays in the code (dte:B38). Spec tools such as Spec Kit, Kiro and OpenSpec live in the middle layer; DTE is the rationale layer under them, never a fourth spec format.

## How it looks

An adopting project:

```
decisions/
  A/A1.md      ring 0: core goals          (made by a human)
  B/B3.md      ring 1: "cite decisions with a dte: token"   parents: [A1, A2]
  C/C3.md      ring 2: "how the scanner finds citations"    parents: [B3]
  inbox/       agent -> human: decisions waiting to be placed, spec gaps
  outbox/      human -> agent: notes and tagged nodes
  RETIRED      ledger of retired ids; numbers are never reused
specs/         what to build; each spec cites the node it serves
tools/dte.py   # dte:B6,C3   <- code cites the decisions it serves
```

A decision node is a markdown file. Its frontmatter is written by the tool, never by hand (dte:B29):

```yaml
---
id: B3
title: "Artifacts cite decisions with a dte:ID token"
status: active            # proposed | active | superseded | reverted
parents: [A1, A2]         # must be in shallower rings; ["[[A1]]", "[[A2]]"] in wikilink form
made_by: ai               # human | ai | joint
by: Claude Fable 5.1
date: 2026-09-02
ratified_by:              # a human's name here settles the node
name: citationToken       # the handle: chat says "B3 citationToken"
---
```

The body is a Decision (one or two citable sentences), a Why (the reasoning and nothing else), Consequences, and a History of one line per event (dte:B41).

Any artifact cites a decision with the token `dte:ID` in a comment or in prose, or as `[[ID]]` when `links = wikilink` is set; `decisions/` then opens directly as an Obsidian vault with lineage as graph edges (dte:B30). Every node has a camelCase `name` beside its `title`; chat says `ID name` (dte:A5, dte:B32).

## The tool

```
# ask the tree
python tools/dte.py show B3           # one decision: lineage, children, citing lines, body
python tools/dte.py find "alias"      # search ids, titles, bodies, ledger, inbox
python tools/dte.py tree [--under B3] # the whole tree ring by ring, or one subtree
python tools/dte.py blast B3          # what would changing B3 touch?
python tools/dte.py trace tools/dte.py   # why does this file exist?
python tools/dte.py conflicts         # who wins each contradiction?
python tools/dte.py coverage          # which artifacts have no lineage yet?
python tools/dte.py scope             # advisory: dead nodes, over-broad nodes, skipped rings
python tools/dte.py retired           # the ledger of retired ids
python tools/dte.py authority         # who holds each ring, so whom to ask
python tools/dte.py unratified        # the full list validate only counts (dte:C23)

# change the tree (frontmatter is never hand-edited)
python tools/dte.py new C --name scannerWalk --title "..." --by agent --parents B3 --decision "..." --why "..."
python tools/dte.py cite src/thing.py C3   # insert the citation in the file's comment syntax
python tools/dte.py ratify B3 B4 --by owner
python tools/dte.py conflict B4 C2    # declare a contradiction on both sides
python tools/dte.py reparent C7 --parents B5 --by agent   # fix an orphan
python tools/dte.py set B3 title "..." --by owner           # the one generic field write: title or confidence
python tools/dte.py contest B3                            # one contest per unratified node: alternatives, costs, verdict
python tools/dte.py contest B3 --record --chosen keep --by agent --note "..."
python tools/dte.py move C4 B --by owner              # promote: new id, old retired, references rewritten
python tools/dte.py retire B5 --by owner --superseded-by B24   # retire through the ledger
python tools/dte.py inbox / place <slug> B --by owner # escalation and placement
python tools/dte.py outbox [--done <ID|note>]  # what the human tagged or dropped in the vault (dte:B31)
python tools/dte.py import <dir> --by <you>    # lift an existing rule corpus, properties unchanged (dte:B33)
python tools/dte.py authorize <ID> --by <human> # record a human's go-ahead on an existing node (dte:C21)

# specs and agents
python tools/dte.py brief C --under B3   # the block to hand a subagent working at ring C
python tools/dte.py spec B3 --out specs/b3.md   # a spec skeleton from a node, for a tree agent to fill
python tools/dte.py brief --builder specs/b3.md # the block to hand a builder: spec only, no ring, no tree
python tools/dte.py gap specs/b3.md --title "..." --by builder   # the spec is silent: file a gap in the inbox (dte:C27)

# check and integrate
python tools/dte.py validate --as C   # consistency; as an agent at ring C, did I overstep?
python tools/dte.py export --out tree.json   # nodes, citations, ledger, inbox: join it to your graph
python tools/dte.py init              # scaffold a new project
python tools/dte.py vendor --from ../DTE   # copy DTE's rules and decisions in, ignored, stamped
python tools/dte.py hook              # pre-commit: refuse commits that break the tree
```

Three rules the tool enforces:

- **Authority follows ring** (A6 authorityByRing). An agent decides at its ring or deeper. Anything shallower, or of unclear ring, goes to `decisions/inbox/` without an ID, and the tool prints "ask so-and-so where this belongs" until a person or a higher agent places it. The map in `dte.cfg` says who holds each ring. It binds agents, never humans.
- **Human-held decisions are protected** (B11 humanHeldProtected). A node a human made or ratified cannot be superseded, reverted, or moved without `authorized_by` naming a human. DTE supplies the flag; honouring it is on the model.
- **Nothing vanishes** (B24 retiredLedger). A node is retired or moved through the tool, which writes the ledger and rewrites every reference. A node file deleted by hand fails validation.

The tool is one file with no dependencies (Python 3.8+). Copy it into any project. Its tests run with `python -m unittest discover -s tests`.

## Working with agents

DTE exists so agents can work autonomously and indefinitely without re-asking what is already decided (A7 autonomy). Three habits carry that, and `CLAUDE.md` spells them out:

- **Two kinds of agent.** A *tree agent* holds a ring, records each non-trivial decision as a node when it makes it (dte:B8), and briefs its subagents one ring deeper with `dte brief`. A *builder* holds no ring and never reads the tree: it gets a spec, builds exactly that, decides nothing, and files a gap when the spec is silent (B42 builderAutonomy).
- **One contest, then settled.** Before the first new work under an unratified node, a tree agent contests it once (keep, opposite, deletion, maybe a variant) judged against the node's parents alone, and records the verdict. After that the node stands and is never re-asked (B28 oneContest).
- **Say the name, name the node.** A decision is always referred to by ID *and* its camelCase name, never a bare "A4", with the title in quotes when the sentence needs it; the reader does not have the file open (A5 idPlusName). A report that something was built names the node that governs it (dte:B17), and an action a node justifies is done and reported, not asked about (dte:B25).

The human answers through the same tree: ratify a node, tag it, or drop a note in `decisions/outbox/` (dte:B31).

## Read next

- `SPEC.md` for the normative rules.
- `decisions/` for this repo's own tree. DTE is built with DTE: every change is a node first, then the tool, then the docs (A9 treeStructure).
- `WALKTHROUGH.md` for the whole life cycle on a toy project, real output.
- `ADOPTING.md` for bringing DTE into an existing project.
- `CLAUDE.md` for how AI agents are expected to behave in a DTE repo.

## Status

Ring A is set by the project owner. Its newest nodes, and most of rings B and C (the format and the tooling), are in effect and being ratified one node at a time; `python tools/dte.py unratified` has the live list. The goal is a finished package that other repos and agents install in one step (dte:A4).
