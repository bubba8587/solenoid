# Code comments — the policy (D30)

Spec-driven development: knowledge lives in specs, decisions, dev-notes, tests, and
commit history — not in comment prose. Comments are the LAST-RESORT home, and the
default outcome for an existing comment under review is DELETION. A surviving line is
the exception that must be argued. Test files (`*.test.ts[x]`) are exempt, for now.

## Where knowledge lives (strongest home wins; a comment is home #5)

1. **The code** — names and types. Rename before commenting.
2. **Machine checks** — a "do NOT do X" that a test can enforce becomes a test
   (the `socketConnect.test.ts` / `coerceInputs.test.ts` pattern). A comment-guard
   is a plea; a test is a wall.
3. **Specs / decisions.md / dev-notes** — semantics, rulings, investigations,
   measurements, negative results. Routed via the table in `README.md`
   ("Code → spec routing").
4. **Commit messages** — all revision history: what the old code did, what changed,
   what bug this fixed.
5. **A comment** — only for a line-granular constraint that is invisible at every
   level above AND likely to be violated by an editor of that exact line. Both
   conditions, not either.

## The cut rules

1. **Revision history → commit message.** "The old code…", "previously…",
   "formerly named…" — delete. If the comment fuses history with a live constraint,
   the present-tense constraint sentence survives alone.
2. **Formal rulings → decisions.md or the domain spec.** A dated ruling, "author
   decided", "we decided" in a comment is a decision misfiled. Record it in the doc,
   delete the comment. Residue at the code site: at most a doc reference, and only
   when the site is the natural relapse point.
3. **Investigations have ONE home.** Experiment narratives, measurements, dates,
   negative-result stories → dev-notes (open problems) or the domain spec. For files
   in the routing table: ZERO comment residue — the table is the pointer. Content
   that exists ONLY in a comment gets promoted to the doc first, never silently
   deleted.
4. **Module headers state scope + hard constraints only.** Cite the governing spec;
   never excerpt or re-teach it (a header copy of a spec is a stale copy waiting to
   happen). Fix stale doc citations on contact.
5. **Doc comments carry contract the signature can't** — ordering guarantees, null
   meaning, units, side effects. A JSDoc that restates the name ("/** Switch to an
   existing document. */ open(id)") is deleted.
6. **Never translate code into English.** If a comment's content is recoverable by
   reading the adjacent lines, it goes. A comment on a line must say what the line
   cannot.
7. **TODOs → backlog.md** (the single to-do home). **Commented-out code → delete**
   (git has it).

## What a GOOD surviving comment looks like

- A non-obvious mechanism at exactly the line it governs: "The sig is
  order-sensitive (join preserves array order), so a Position-mode re-sort changes
  it → the list re-renders within a poll."
- A contract the types can't say: "/** Documents, most-recent first, for menus. */"
- A trap invisible in the code: "`area.translate` is async — it won't share a paint
  with your React commit."

When unsure whether a comment's knowledge exists in a doc: check the routing table
and the named spec; if it truly lives nowhere else and is worth keeping, promote it
to the right doc (or keep the line, if it fails no rule above). Nothing is ever
lost either way — git history holds every deleted line.
