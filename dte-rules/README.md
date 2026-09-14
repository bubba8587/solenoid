<!-- dte:A1,A2,A3,A4,A5,A6,A7 -->
# Decision Tree Engineering (DTE)

**Every thing in a project exists because a decision was made.** DTE makes that
lineage explicit, ring by ring, so that when a decision changes you know exactly
what it touches.

Think of a tree: the core is a handful of abstract goals (ring `A`). Each
ring outward is a layer of decisions made *because of* the ring inside it.
Code, config, docs and tests are the leaves and bark. Each one cites the
decision(s) it exists to serve.

DTE works **alongside** structural methods such as graph engineering. A
dependency graph tells you *what* touches *what*. The decision tree tells you
*why* any of it is there, and who decided.

## The one rule that matters (A1)

> If a decision is changed or reverted, it is possible to know exactly what
> layers that decision applies to and its blast radius. A decision can be moved
> up and down the hierarchy; a superseding or contradictory decision higher in
> the hierarchy always takes preference over one lower down.

Everything else in this repo descends from that. See `decisions/A/A1.md`.

## How it looks

```
decisions/
  A/A1.md      ring 0: core goals          (made by a human)
  B/B3.md      ring 1: "cite decisions with a dte: token"   parents: [A1, A2]
  C/C3.md      ring 2: "how the scanner finds citations"    parents: [B3]
tools/dte.py   # dte:B6,C3   <- code cites the decisions it serves
```

A decision node is a markdown file with frontmatter:

```yaml
---
id: B3
title: Artifacts cite decisions with a dte: token
status: active            # proposed | active | superseded | reverted
parents: [A1, A2]         # must be in shallower rings
made_by: ai               # human | ai | joint
by: Claude Fable 5.1
date: 2026-09-02
---
```

Any artifact cites a decision with the token `dte:ID` in a comment or in prose.

## Ask the tree

```
# ask the tree
python tools/dte.py show B3           # one decision: lineage, children, citing lines, body
python tools/dte.py find "alias"      # search ids, titles, bodies, ledger, inbox
python tools/dte.py tree              # the whole tree, ring by ring
python tools/dte.py blast B3          # what would changing B3 touch?
python tools/dte.py trace tools/dte.py   # why does this file exist?
python tools/dte.py conflicts         # who wins each contradiction?
python tools/dte.py coverage          # which artifacts have no lineage yet?
python tools/dte.py scope             # advisory: dead nodes, over-broad nodes, skipped rings
python tools/dte.py retired           # the ledger of retired ids
python tools/dte.py authority         # who holds each ring, so whom to ask

# change the tree (frontmatter is never hand-edited)
python tools/dte.py new C --title "..." --by agent --parents B3 --decision "..." --why "..."
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

# check and integrate
python tools/dte.py validate --as C   # consistency; as an agent at ring C, did I overstep?
python tools/dte.py brief C --under B3   # the block to hand a subagent working at ring C
python tools/dte.py export --out tree.json   # nodes, citations, ledger, inbox: join it to your graph
python tools/dte.py init              # scaffold a new project
python tools/dte.py hook              # pre-commit: refuse commits that break the tree
```

Two more rules the tool enforces, both from the core:

- **Authority follows ring** (A6). An agent decides at its ring or deeper.
  Anything shallower, or of unclear ring, goes to `decisions/inbox/` without
  an ID, and the tool prints "ask so-and-so where this belongs" until a
  person or a higher agent places it. The map in `dte.cfg` says who holds
  each ring. It binds agents, never humans.
- **Human-held decisions are protected** (B11). A node a human made or
  ratified cannot be superseded, reverted, or moved without `authorized_by`
  naming a human. DTE supplies the flag; honouring it is on the model.

And one rule for talking about the tree (A5): a decision is always referred
to by ID *and* its title, never a bare "A4". The reader does not have the
file open.

The tool is one file with no dependencies (Python 3.8+). Copy it into any
project.

## Read next

- `SPEC.md` for the normative rules.
- `decisions/` for this repo's own tree. DTE is built with DTE.
- `WALKTHROUGH.md` for the whole life cycle on a toy project, real output.
- `ADOPTING.md` for bringing DTE into an existing project.
- `CLAUDE.md` for how AI agents are expected to behave in a DTE repo.

## Status

The A-ring is set and ratified by the project owner. Rings B and C describe
the format and tooling and are being ratified one node at a time. The goal is
a finished package that other repos and agents install in one step (dte:A4).
