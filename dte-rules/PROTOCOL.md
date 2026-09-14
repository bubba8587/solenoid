<!-- dte:B8,B14,B15,B17,B18,B19,B20,B25,B28 -->
# Working in this repo (and any DTE repo)

This project uses Decision Tree Engineering. Read `SPEC.md` once. Then follow
this protocol in every session. It exists because of B8 "AI agents record
each non-trivial decision as a node at the time they make it", which exists
because of A3 "every decision records who made it, human or AI".

## Your ring

You operate at a ring. If the human or the agent that spawned you told you
which, use that. In this repo, if nobody said, assume ring **B**: the owner
holds A, and subagents you spawn get C or deeper. Put the output of
`python tools/dte.py brief C [--under <ID>]` at the top of every
subagent's instructions and set `DTE_RING=C` in its environment (B27).
`python tools/dte.py authority` shows who holds each ring and therefore
whom to ask.

The map binds you, not the owner. The owner may decide at any ring.

## Permissions you hold (and how they get switched off)

Each of these is a node. If the owner reverts or supersedes it, the
permission is gone and the action becomes an inbox item instead.

- You may edit this file, and any agent-instruction file, within your ring,
  citing the node each change reflects: B18 "agents may edit CLAUDE.md
  within their ring; this permission is a node so the owner can revoke it".
- You may keep and update private memory. It is outside the tree. Any rule
  about how work here is done must also be a node; memory holds a pointer,
  never the only copy: B19 "agents may keep private memory; any rule that
  governs project work is also a node".
- Ask the owner in plain chat text, never through the question dialog:
  B20 "questions for the owner are asked in plain chat text".

## Before you change anything

1. `python tools/dte.py tree` to see the current tree and the inbox, and
   `python tools/dte.py show <ID>` to read any one decision without
   opening the file.
2. If you are about to edit an existing node, run
   `python tools/dte.py blast <ID>` first and read the whole report.
   Everything listed is your responsibility to reconcile.
3. If the node is human-held (made by a human, or ratified by one), you may
   not supersede, revert, move, or reword it. Ask. A human's name must be
   in `authorized_by`, on the node or in the ledger line, before validate
   will pass (B11).

## While you work

- Every artifact you create or substantially change carries a citation:
  `python tools/dte.py cite <file> <ID>` puts it at the top in the right
  comment syntax; line-level citations are written by hand. Cite the most
  specific node that explains it.
- If no existing node explains a choice you are making, and a reviewer could
  reasonably ask "why?", that is a new decision. Decide where it belongs:
  - **At your ring or deeper**: create it with
    `python tools/dte.py new <ring> --title "..." --by <your model name>
    --parents ... --decision "..." --why "..."`. Never hand-write
    frontmatter and never pick numbers by hand (B29). Say what you decided,
    why the parents demanded it, and what it implies. `--confidence medium`
    or `low` when guessing the owner's preference, and say so.
  - **Shallower than your ring, or you are not sure**: do not create it.
    Write `decisions/inbox/<slug>.md` (SPEC section 7, Escalate) and ask
    the holder of that ring in chat, giving the title. It gets an ID only
    when someone with authority runs `dte place`.
- Never hand-delete or rename a decision file. Retire it with
  `python tools/dte.py retire` (supersede or revert) or move it with
  `python tools/dte.py move`; both write the ledger and rewrite references
  (B24, B23). A deletion with no ledger line fails validation.
- Never resolve a contradiction by editing the loser. Precedence is
  position. If the ring order gives the wrong answer, that is a move, and
  moves above your ring are not yours to make.

## Before you act under an unratified node (B28)

A node marked `unratified` and not `contested` gets one contest before you
first act under it: `python tools/dte.py contest <ID>`. Build the
alternatives it lists (keep, opposite, deletion, maybe a variant) far enough
to scope their cost, judge them against the parents alone, pick one, and
record it with `--record`. Parents are the rubric: read, never reopened.
Siblings are not touched. Children and citing artifacts count for nothing,
not even as cost. If keep lost, write the winner with `new` and retire the
loser. After that the node is settled: act on it and never re-ask (A7).
This is B28 "an unratified node gets one recorded contest: alternatives
built, costed, judged by its parents; then settled".

## When you talk about decisions (A5)

Never name a decision by bare ID in chat. Always give the ID with its title,
for example: A5 "a decision is always referred to by ID plus a short dense
summary, never by bare ID". The reader almost certainly does not have the
decision file open. `python tools/dte.py tree` prints the ID-plus-title form
for every node; copy from there. When you write a node, make its `title`
dense enough to stand in for the decision in a sentence, under 100
characters.

## What a node justifies, you do (B25)

If an in-effect node covers an action, take it and report it as
`ID "title"`. That line is the whole justification. Do not ask whether the
owner would prefer otherwise, do not offer to stop doing it next time, and
do not re-argue the node. Example: an owner decision forces an edit to a
ring-A file; you write `authorized_by: project owner` on it and report
"B11 'human-held nodes need authorized_by from a human to be superseded,
reverted, or moved; configurable'". Done. Doubt belongs only to actions no
node covers, and those go to the inbox, not into the report as hedges. The
owner disagrees through ratification, not through your asking.

## When you report work (B17)

Every time you tell the owner that something now exists or was built, name
the decision that governs it in the same message, as ID plus title. If you
created that node during the work, say so right there, not in a closing
list. "The inbox is built" is incomplete; "the inbox is built, governed by
B14 'unplaced decisions wait in decisions/inbox without an ID until someone
with authority places them', which I created" is complete. The owner may
want to overrule the decision, and cannot if they only hear about the
artifact.

## Before you say you are done

- `python tools/dte.py validate --as <your ring>` must print `OK`. Warnings
  are allowed; read them anyway. It fails if you touched a node above your
  ring or a human-held node.
- Validate ends with "Nodes changed in this working tree". Copy those lines
  into your report so the owner can ratify them. List anything you put in
  the inbox, with the question it is waiting on. Unratified AI decisions
  are also printed; do not try to clear that list yourself.

## Rings in this repo

- `A` core goals, all ratified by the owner. Do not add to ring A. Inbox it and ask.
- `B` format and rules of DTE itself.
- `C` how the reference tool implements ring B.

## Conventions

- Python 3.8+, standard library only, one file for the tool (B6).
- Keep prose short. The Why section carries the argument; the Decision
  section is one or two citable sentences.
