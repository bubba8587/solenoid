# Using the tree from here

**Tell an agent something.** Tag a node, or drop a note in `outbox/`. The next session picks it up.

| Tag | Means |
|---|---|
| `#ratify` | I accept this decision |
| `#retire` | Revert it |
| `#contest` | I disagree; build the alternatives |
| `#ask` | Answer the question next to this tag |

Tags go in the `tags` property or inline in the body. Typing your name into `ratified_by` also counts.

**Write a decision.** New note in `outbox/`, any shape. Say what and why. Above ring C it becomes an inbox item first.

**Find things.** `[[C41]]` by ID, `[[branchModel]]` by name. `DTE.base` has the Outbox, Unratified, Contested, Inbox and All views.

**Never.** Rename or delete a node file, or change `id`, `parents`, `status`. Those go through the tool.

**Buttons.** Templates live in `templates/`. Point Settings → Templates → folder at it, then pin "Templates: Insert template" with Commander to insert *Outbox note* or *Ask* in one click.

**Agent side.** `python tools/dte.py outbox` lists what you left, `--done <ID or note>` clears it, `validate` prints the count. Details: `docs/dte.md`.
