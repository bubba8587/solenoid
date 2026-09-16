# Solenoid demo vault

A small, self-contained Obsidian vault for building and eyeballing the Obsidian
integration. It is also the fixture set: the pure-core tests read this tree directly
(one source of truth, no `tests/fixtures/vault/` copy to drift), and it is the vault to
point a desktop build at.

It is deliberately varied so every typing path and cell shape is exercised, and big
enough that the seeds have real rows to compute over:

- **`Projects/`** — an **mdbase collection** (`mdbase.yaml` + `_types/project.md`), six
  notes covering all four `status` values (planning · active · blocked · done). Types come
  from the mdbase schema: `status` (enum → string), `priority` (integer → number), `budget`
  (number), `due` (date), `tags` (list), `milestones` (array of objects → a nested cube
  cell). The typing source of first resort.
- **`Notes/`** — a **plain folder** with no schema. Three books (`Deep Work`,
  `Atomic Habits`, `The Pragmatic Programmer`) carry `rating` / `read` / `started` /
  `finished` typed from **`.obsidian/types.json`** (one has no `finished`, so the column has
  a null); the meeting and course notes fall to the guesser. `Spanish course.md`'s
  `sessions` is a list of records with their own tag lists — a nested cube. Wikilinks,
  `#tags`, and an `![[embed]]` appear in bodies.
- **`Daily/`** — the **daily-notes folder** (`.obsidian/daily-notes.json`: `YYYY-MM-DD`),
  a two-week run (`2026-08-25` → `2026-09-07`). Each note carries `mood` / `sleep` /
  `weight` / `exercised`. With R3 the file name parses into a `date` column, so these become
  a time series long enough for a rolling average.
- **`Tasks/`** — **TaskNotes-shaped** notes (eight, across the projects): the frontmatter
  the plugin writes, including block-style `timeEntries` (the nested shape the v1 parser
  keeps as raw text), `complete_instances`, recurrence rules, and `blockedBy` as a wikilink
  list. Statuses span open · in-progress · done.
- **`People/`** — link targets (Sam · Ada · Priya), so wikilinks in properties and bodies
  resolve.
- **`Solenoid/`** — one graph-stub note (`type: solenoid`), the shape a writer creates so
  backlinks answer "which graph wrote this" (item D).
- **`Projects.base`** — one Bases table view, so a note can show a live table over what a
  Solenoid Write Properties run produces.

## What the seeds do to it

Three seeds in the **Obsidian** group target this vault:

- **Your vault as a table** — a Vault Folder over `Notes/` → the cube; Filter
  `tags contains book`, Sort by `rating`. The A showcase (read).
- **Write it back to Obsidian** — a project snapshot → Computed Column (a `health` label
  from status + priority) → a disarmed Write Properties. The B loop (compute here, see it in
  a Bases view). Swap the snapshot for the Vault Folder on desktop.
- **Daily notes as a time series** — a daily snapshot → Window (7-day rolling average) →
  a smoothed line chart, with the live Vault Folder over `Daily/` beside it (R3).

The snapshot-plus-live-node shape is deliberate: seeds load on the web with no vault, so the
compute runs on a Frame Input snapshot while the real Vault Folder / TaskNotes node sits
beside it as "replace me on desktop".

Nothing here is secret or real; edit freely.
