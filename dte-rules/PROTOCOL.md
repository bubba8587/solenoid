<!-- vendored from DTE 0.2 (f4df54a) on 2026-10-31. Do not edit; refresh with: python tools/dte.py vendor --from <a DTE checkout> --dir dte-rules -->

<!-- dte:B8,B14,B15,B17,B18,B19,B20,B25,B60,B46,B47,B48,B49,B52,B53,B56,B57 -->
# The DTE agent protocol

This project keeps its decisions as a Decision Tree Engineering tree. One decision is a **leaf**: a markdown file under `decisions/<ring>/`. Read `SPEC.md` once, then follow this protocol in every session. The tool is `tools/dte.py` (run `python tools/dte.py --help`); below it is written `dte`.

DTE governs the tree and nothing around it. This project's own process (triage, backlog, release habits, house voice) lives in its own instructions, and where they and this file both speak, this file covers the tree and theirs covers the rest.

## Your ring

You operate at a ring. If the owner or the agent that spawned you said which, use that. Otherwise ask the owner before your first task that works under a leaf, in plain chat. Until the owner answers, and in a run nobody watches, work at the ring this project's instructions name for that case (B52 askYourRing). `dte authority` shows who holds each ring, and therefore whom to ask.

Every subagent you spawn works one ring deeper than you: put the output of `dte brief <ring> [--under <ID>]` at the top of its instructions and set `DTE_RING=<ring>` in its environment. A subagent that only builds gets no ring and no tree: write the spec (`dte spec <ID> --out specs/<name>.md`, then fill it) and put `dte brief --builder specs/<name>.md` at the top of its instructions. Gaps it files land in the inbox addressed to the spec; answer them in the spec.

The ring map binds agents, not the owner. The owner may decide at any ring.

## Permissions you hold

Each is a leaf. If the owner reverts it, the permission is gone and the action becomes an inbox item.

- You may edit agent-instruction files within your ring, citing the leaf each change reflects (B18 agentsEditClaudeMd).
- You may keep private memory. A rule about how work here is done must also be a leaf; memory holds a pointer, never the only copy (B19 privateMemory).
- Ask the owner in plain chat text, never through a question dialog (B20 askInChat).

## Before you change anything

1. `dte outbox`: what the owner tagged or dropped in the vault. Process every item first; the owner's word there is the authorization.
2. `dte tree` for the tree and the inbox; `dte show <ID>` for one leaf.
3. Before you edit an existing leaf, `dte blast <ID>`, and read the whole report. Everything in it is yours to reconcile.
4. A human-held leaf (made by a human, or ratified by one) is not yours to supersede, revert, move, re-parent or reword. Ask. A human's name must be in `authorized_by` before validate passes.

## While you work

- Every artifact you create or substantially change cites what it serves: `dte cite <file> <ID>` writes the header in the right comment syntax. Cite the most specific leaf. A file built to a spec whose `covers:` glob matches it needs no citation of its own.
- A citation replaces a WHY comment. The reason moves into the leaf's Why, a HOW explanation into the spec, and only WHAT the block does stays in the code.
- A choice no leaf explains, that a reviewer could ask "why?" about, is a new decision. Before writing it, test it:
  - **Is it a leaf?** A leaf is a call a person could weigh and choose otherwise, in the project's plain words. Name the call and its opposite: a sentence that would still be true had the opposite been chosen is mechanics, and mechanics go in a spec (B47 leafIsACall).
  - **Is it a child?** A child decides a question its parent leaves open. One that restates part of its parent, or details it, belongs in the parent's Consequences (B48 childIsFork).
  - **At your ring or deeper:** `dte new <ring> --name <camelCase> --title "..." --by <your model name> --parents ... --decision "..." --why "..."`. Never hand-write frontmatter or pick numbers. The Decision is one or two citable sentences. The Why is the plain reason a person would say; it may lean on the parent ("we want the parent, so we want this") and never piles up specifics to make the parent look right. If you are guessing the owner's preference, the Why says so.
  - **Shallower than your ring, or unsure:** write `decisions/inbox/<slug>.md` and ask the ring's holder in chat, giving the title.
- A leaf's Decision, Why and Consequences cite only shallower rings (B49 citesUpOnly). What a child adds, the child says.
- A MUST is cited by the test that enforces it, or its Consequences carry an `*Unenforced:*` line saying why no test can. A bug fix ships with the check that would have caught it (B46 mustEnforced).
- An exception lives under its rule, as its child, with a "Removed by:" line naming what would remove it. An exception nothing could remove means the rule was written wrong.
- Never delete, rename or renumber a leaf file by hand. The tool does each and writes the ledger: `retire` (supersede or revert), `move` (another ring), `fold` (an aspect back into its parent), `to-spec` (mechanics into a spec), `renumber`, and `merge-ids <base>` before a branch merges.
- Never resolve a contradiction by editing the loser. Precedence is position; if the ring order gives the wrong answer, that is a move.
- If your environment refuses an edit to the tree, stop that change. Ask the owner for an authorization in chat that names the leaves, and never reach the same result another way (B53 refusedEditStops).

## Before you build under an unratified leaf

A leaf marked unratified and not contested gets one contest before you first build new work under it: a child leaf, a spec, an artifact. Run `dte contest <ID>`, build the alternatives it lists (keep, opposite, deletion, maybe a variant) far enough to scope their cost, judge them against the parents alone, and record the verdict with `--record`. Parents are the rubric, read and never reopened; siblings are not touched; children and citing artifacts count for nothing, not even as cost. If keep loses, `--record --chosen variant --title ... --body-file ...` writes the winner and retires the loser in one run. After that the leaf is settled: act on it and never re-ask (B60 oneContest).

Re-homing text that already governs built code owes no contest: an import, a fold, mechanics moved into a spec. A rewrite the owner directs settles the leaf.

## When you talk about decisions

Never name a decision by bare id. Give the id with its name, for example A5 idPlusName, and add the title in quotes when the reader needs the sentence. The reader almost certainly does not have the file open; `dte tree` prints `ID name: title` for every leaf. A new leaf's name is two or three words a reviewer would say aloud; its title stands in for the decision in one sentence, under 100 characters.

## What a leaf justifies, you do

If an in-effect leaf covers an action, take it and report it as `ID name`, title quoted if useful. That line is the whole justification. Do not ask whether the owner would prefer otherwise, do not offer to stop next time, do not re-argue the leaf (B25 neverReask). Doubt belongs only to actions no leaf covers, and those go to the inbox. The owner disagrees through ratification.

## When you report work

Every time you tell the owner something now exists, name the leaf that governs it in the same message, as ID plus name. If you created that leaf during the work, say so right there (B17 reportNamesDecision).

## Before you say you are done

- `dte validate --as <your ring>` must print `OK`. Read the warnings anyway.
- A hand edit to a leaf's body adds one History line. A wording-only sweep across many leaves is logged once instead: `dte editorial --by <you> --note "..." [--replace old=new]`.
- Copy the "Leaves changed in this working tree" block into your report so the owner can ratify. List anything you put in the inbox, with the question it waits on. Do not try to clear the unratified list yourself.
