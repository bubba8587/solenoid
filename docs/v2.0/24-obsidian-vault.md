# Bundle 24 — Obsidian: the vault as a table (+ TaskNotes, mdbase)

**Source:** author asks 2026-09-06 ("a tighter integration between Obsidian and Solenoid — not
an Obsidian plugin; using Solenoid's advanced features and objects"; then TaskNotes + mdbase;
Bases syntax; relative dates). **Verdict:** PROPOSAL. The author has **no strong opinion** on
the open calls, so § Defaults are what a build session takes without asking. **Written:**
2026-09-06, plan-only. The ecosystem facts are a same-day web read and WILL rot (mdbase is
pre-1.0 and breaks by policy). Build history is in git and the 2026-09-06 digest; this doc
states what stands.

## What stands today (pointers, not restatement)

**Landed 2026-09-07** (the author promoted the bundle to the flagship track; each item's
outcome is in `../node-coverage.md`, cited here by name): **A** Vault Folder → Cube (+ R3, the
demo vault at `demo-vault/`), **A′** the row verbs take cubes, **B** Write Properties, **C** Write
to Obsidian modes + templates (R1/R2), **D** Open in Obsidian (the stub note is in progress), **E**
the vault watcher, **F** TaskNotes feed + **F6** Write Tasks (+ the `which-task-next` seed = F4),
**I** the Import Note's reload cadence, **J** the headless seam, **R5** midnight rollover, and
**H6 Schedule** cube-in/cube-out with the **Cube Input** literal source; D's stub note +
`solenoid:` link (opt-in), mdbase validation on write, `writeBase`, and the F1 seed
(`kitchen-remodel-tasknotes`, Computed Column over a cube). G/K on hold; H is ruled out below
mdbase 1.0 (`../decisions.md` mdbaseCeiling).

- **Import Obsidian Note** (`nodes/obsidian.ts`, a `NoteNode` subclass): one `.md` → its
  frontmatter keys as typed output sockets + a `document` output; manual Reload. **Write to
  Obsidian** (`obsidianMarkdown.ts` + `obsidianWrite.ts`): a Document → one overwritten `.md`
  (pipe tables, mermaid fences, `$$` math, rasterized chart PNGs, `![[asset]]` embeds),
  Run-button only (`sinkRunButtonOnly`). Spec homes: `../node-coverage.md` § Connections &
  sinks / § Annotation, `../socket-reference.md` § `document`.
- **Note frontmatter** → sockets (`noteFrontmatter.ts`, `FIELD_SOCKETS` in `annotation.ts`). A
  deliberate YAML subset: scalars, flow arrays, block lists, rows-of-inline-objects → a frame.
  Gaps this bundle closes: ISO datetimes land as strings; block-style nested objects (the
  shape TaskNotes writes `timeEntries` in) are not parsed.
- **Decision Matrix** is the author's Bases-view plugin, math only (`../node-coverage.md`
  § Decision support). **H6 Schedule** is specced in `../1.4-plan.md` § Scheduling slice,
  gated on the Track H pick (`../backlog.md`).
- **`relativeDatesOptIn`** (`../decisions.md`): a stored date is a fixed calendar day; relative
  phrases resolve only on a Date Input under a setting, re-resolving each pass with an Alert
  when the day moves.
- Constraints a vault feature meets: (1) the desktop fs allowlist
  (`src-tauri/capabilities/default.json`) is **by extension** — text read/write only for
  `$HOME/**/*.{json,csv,md}`; (2) the vault root is the app-wide `obsidianVault` setting; (3)
  **no file watcher** exists (`21-collaboration.md` Stage 0 is its home); (4) live sources are
  *connection* nodes (`nodes/connection.ts`: cache token `<globalGen>:<nodeToken>:<reference>`,
  background fetch, `refreshConnection`, `refreshMinutes` — `../subsystem-invariants.md` § Live
  connections); (5) the vault walk (`fileBridge.ts`) skips dot-folders, depth 6; (6) a frame
  column is number / string / logical / date only — lists and nested objects need a **cube**
  (`CubeCell`), and the lattice refuses a cube at a `frame` socket (`sockets.ts`); (7) the
  composite **Monte Carlo** run mode samples SCALAR ports and summarises scalar outputs;
  **by-row** iterates a frame's rows or a list (not a cube) into a series per output
  (`composite.ts`).

## The line

The vault is the author's database and TaskNotes is its tracker. Solenoid **computes over**
the vault and writes results back as properties or blocks; it never stores, tracks, or renders
a kanban (`../out-of-scope.md` §5, §8). No Obsidian plugin: every touchpoint is a file, a local
HTTP port, or a URI. A reader emits **one `cube`** (a folder of notes IS records whose fields
can be lists or sub-tables); the row verbs take cubes (A′), so filtering and sorting notes
never needs a flattening step; writers take a cube; a sink's preview is a `plan` frame.

## The ecosystem (read 2026-09-06)

**Obsidian properties.** text · list · number · checkbox · date (`2020-08-21`) · date & time
(`2020-08-21T10:30:00`) · tags; names unique per note; links in properties are quoted
`"[[Note]]"`. The vault's property-type registry is `.obsidian/types.json`
(`{"types": {"due": "date", …}}`). The Daily notes core plugin stores `folder` / `format` /
`template` (`.obsidian/daily-notes.json` — **verify** the file name against a real vault);
templates use `{{date}}` / `{{date:FORMAT}}` (moment tokens).

**Bases** (`.base` YAML): global `filters` (an `and`/`or`/`not` tree of expression strings),
`formulas` (a JS-flavoured expression language with typed methods), `properties` (display
names), `summaries` (Average · Min · Max · Sum · Range · Median · Stddev; Earliest · Latest;
Checked · Unchecked; Empty · Filled · Unique), `views` (table / cards / list / kanban / map;
one `groupBy`, `order`, `limit`); `file.*` = name · path · folder · ext · size · ctime · mtime ·
tags · links · embeds · backlinks (marked "performance heavy") · properties; list methods
`contains` / `containsAny` / `containsAll` / `isEmpty`; embeddable as `![[File.base#View]]`
with `this` = the embedding note. Per-row only: no joins, no traversal, no simulation.

**TaskNotes** (callumalpass/tasknotes; stable 4.12.x, 5.0.0-beta Aug 2026). One task = one
note; frontmatter `title status priority due scheduled tags contexts projects timeEstimate
timeEntries recurrence complete_instances dateCreated dateModified` + `blockedBy`, reminders,
user fields; **property names are user-mappable**. Views are Bases views. **Local HTTP API**
(opt-in, `localhost:8080`, optional bearer token, OpenAPI at `/api/docs`): `GET /api/tasks`
(paged), `POST /api/tasks/query` (FilterQuery tree), `GET /api/stats`, `GET /api/time/summary`,
`GET /api/tasks/:id/time`, `GET /api/calendars/events?start&end`, `PUT /api/tasks/:id`, `POST
/api/tasks`, `POST /api/nlp/create`. **Webhooks**: 15 events, HMAC-SHA256, `transformFile`.
Companions: `tasknotes-app`, `tasknotes-workflows` (markdown workflows on the mdbase
`runtime_workflow` schema), `canvas-bases` (materializes a Bases view to `.canvas`).

**mdbase** (mdbase-dev/mdbase-spec, v0.3.0). A collection = a folder with `mdbase.yaml`
(`spec_version`) and a `_types` folder of markdown type files (`kind: mdbase.type`, `name`,
`match.path_glob` relative to the collection root, JSON Schema 2020-12 `schema.value`).
Queries: `types` + CEL `where` + `order_by`; also links, lifecycle (ids, timestamps, digests),
views, record/event/action contracts. Implementations: the TS reference (`mdbase` on npm);
the TS CLI archived 2026-08-07 for the native Rust `mdbase` binary in **mdbase-connect**
(beta; Linux/macOS/Windows; adds identity, per-collection authorization, hosted mirrors, an
MCP endpoint); `mdbase-tasknotes` (`mtn`, ships the task type); `mdbase-obsidian` (v0.3,
type-first: inits, edits schemas, validates — **does not execute queries**); `mdbase-lsp`.
TaskNotes 5.0 auto-upgrades its metadata to the v0.3 task type.

**The reading.** The ecosystem is converging on typed markdown collections whose schema lives
in the vault and whose **query execution and computation are explicitly left to companion
tools**. Solenoid is that companion with a canvas.

## The items

**A. Vault Folder → Cube** (keystone; a connection node, Add → Connections). Init: `vault`
(absolute path per node, the `FileLinkNode.path` pattern, defaulting from the setting at
creation, shown as a chip), `folder` (vault-relative, "" = root), `glob`, `includeBody` (off),
`nameFormat` (R3), `refreshMinutes`. One row per note; one output **`cube`** ("Notes").
Columns: built-ins `path · name · folder · ext · size · created · modified · tags · links ·
embeds · date` (the Bases `file.*` set without the prefix — a dotted name would need
`@[file.name]` in every formula; the equivalence is one help line; `backlinks` skipped, it is
a Filter on `links`), then the union of frontmatter keys in first-seen order. `tags` = the
property merged with inline `#tags`; `links` = every `[[wikilink]]` in body + frontmatter;
`embeds` = the `![[…]]` subset — one regex pass over text already in memory, not gated by
`includeBody`; a frontmatter `tags` key folds into the built-in. Cells: scalars typed below; a
list → a list cell; a rows-of-objects key → a nested frame (`rowsToFrame`); a block-style
nested object → a nested frame once the parser learns the shape (v1 parser item; until then
the raw YAML text as a string, never a dropped key). Typing = how scalars and list items PARSE
(a cube column has no declared type), first source that answers wins: (1) an **mdbase type**
whose `path_glob` matches (walk up for `mdbase.yaml`; needs `.yaml`/`.yml` in the allowlist):
`string`/`number`/`integer`/`boolean`/`enum` → string/number/number/logical/string, `format:
date`/`date-time` → date, `array` of scalars → list cell, `array` of `object` → nested frame
typed by its `properties`, `required` keys always present; (2) **`.obsidian/types.json`**
(direct read; **verify** the capability glob matches a dot-folder segment, else add the path):
text/number/checkbox/date/datetime/list/tags/aliases → the obvious; (3) the guesser, widened
per column across rows (mixed → string, all-null → string). ISO datetimes → fractional serials
(one parser, fixes the Note path too). The cube is an **eager JS value** (no `FrameRef`; the
Decision Matrix class, not Local File's lazy handle). Web: exists, desktop-only hint, emits
nothing. Pure cores: `vaultCube.ts` (`notesToCube(files: {path, text, mtime}[], types)`),
`mdbaseTypes.ts`, `obsidianTypes.ts`, `dailyNotesConfig.ts`; tests over `fixtures/vault/` (an
mdbase collection, a plain folder, a folder with types.json, a daily-notes folder).

**A′. The row verbs take cubes** (a general change; sequenced first). Verbs that read only
scalar columns and keep rows whole accept a cube on their table input (`cubeIn("Table /
Cube")`, the XLOOKUP precedent); nested cells ride along by reference. **Filter, Sort, Head,
Distinct, Get Row** are passthroughs: a cube in → a cube out, output type adopting through the
passthrough declaration (`nodes/passthrough.ts`, `single` mode). **Get Column** (scalar column →
list; list column → `#SHAPE!` in v1), **Decision Matrix** (scalar criteria; list/nested
columns ignored like date columns; still emits its ranking frame) and **H6 Schedule**
(Predecessors as text OR a list cell; cube in → the same cube + four columns) read a cube
without being passthroughs. **Filter on a list cell:** `contains` · `contains any` · `contains
all` (comma-separated values) · `is empty` — Bases' trio, because "notes tagged x" is THE
vault query; every other operator on a list, and Sort on a list, → `#SHAPE!`. "Notes linking
to X" is `links contains X`; Nest Join notes × links is the link graph as a cube. Mechanism:
ONE helper `selectCubeRows(cube, indices)` in `frame.ts`, fed by each verb's existing
predicate / sort key over the scalar column, on the eager JS branch (`isCubeValue`) before the
lazy path; Polars never sees a nested cell; no `FrameOp`, `oneVerbCorpus` untouched.
Aggregating / reshaping verbs (GROUPBY, PIVOTBY, Join, Append, Add Column…) stay frame-only —
Cube Rollup / Nest Join / Unnest own nested semantics. The only list→text join is **Write
File** CSV mode (`", "`). Tests: `cubeRowVerbs.test.ts` (rows selected; nested cells identical
by reference; `__cube` brand out).

**B. Write Properties** (sink, Add → Connections; Run-button only). Input `cube` (a frame
widens); needs a `path` column. Init: `keys` (columns to write; never `path`), `vault`,
`addMissing` (on), `stamp` (off, D), `writeBase` (off, below). `data()` caches only and emits
**`plan`, a frame** (`path · key · before · after · action`): from `data()` alone every row ×
key with `after` filled and `action = pending`; the **Preview** button (reads, never writes)
fills `before` and resolves `action` ∈ update / add / unchanged / unreadable / refused +
reason; the status line summarises the resolved frame; Run requires a resolved plan and
applies it through the atomic tmp+rename write. **Patch is line-level over the raw text,
never parse-and-reserialize:** the top-level `key:` line inside the fence; a scalar replaces
the rest of the line (`yamlScalar` quoting); a list replaces the line + its `- ` block; a
nested frame cell → a `- {k: v}` block (the rows-of-objects shape A reads back — a cube
round-trips losslessly); a key whose current value is an unparsed block is **refused** for
that row; a missing key is appended before the closing `---`; a note with no block gets one.
Dates `YYYY-MM-DD`, datetimes `YYYY-MM-DDTHH:MM:SS`, logicals `true`/`false`. mdbase-aware:
validate the outgoing value against the note's type (type / enum / min / max / required, an
in-process subset) and refuse the row rather than corrupt a record. **A new key arrives
typed:** `addMissing` also registers the type in `.obsidian/types.json` (one-key JSON merge).
**Note references write as links:** a string cell equal to an existing note's path or name
serializes as `"[[Name]]"` (frontmatter) / `[[Name]]` (tables, incl. `frameToMarkdownTable`).
**Timestamps:** a note carrying `dateModified` (TaskNotes) or an mdbase lifecycle `updated`
field gets it bumped in its existing form; none is added. **`writeBase`:** also write `<node
name>.base` beside the notes — `filters: file.inFolder("<folder>")`, one table view ordered by
`file.name` + the written keys — so a managed block (C) can embed `![[<node name>.base#View]]`
and the note shows a **live** table over what B wrote. Pure core `frontmatterPatch.ts`
(`patchFrontmatter(text, patch): {text, refused[]}`), the ONE writer of a note's YAML
(`onePatchPath` candidate); tests prove untouched bytes identical and cube → vault → cube equal.

**C. Write to Obsidian: modes + templates.** `mode: overwrite | append | block`. `block`
splices the assembled markdown between `%% solenoid:begin <node name> %%` and `%%
solenoid:end %%` (hidden in reading view; the addressable name keys the pair, so two writers
own two blocks); first write appends the pair, later writes replace the span; content holding
`%%` outside a code fence is **refused** with the reason — nothing invisible is written. File
name and subfolder take the § R grammar (`{{date}}`, `{{daily}}`, `{{name}}`, `{{doc}}`); an
optional `date` input socket feeds it. Pure `managedBlock.ts` (`spliceBlock`) tested on: no
markers, two pairs, markers in a code fence (fences win), begin without end (fresh pair,
orphan left).

**D. Links both ways.** A note Write to Obsidian writes gets `solenoid: "[[Solenoid/<document
name>]] › <node name>"` — a **wikilink to a graph stub note** that the first write creates
(`Solenoid/<doc>.md`: `type: solenoid`, `nodes:` the writer names, `updated:`; body: what this
graph writes where, and with J the `run-graph … --run` line) and later writes refresh.
Backlinks then answer "which graph wrote this", the graph view draws the edge, a Bases view
over `Solenoid/` lists every graph touching the vault. The `stamp` toggle is **off** by
default everywhere (author 2026-09-07, opt-in); when on, Preview names the stub path before
Run. Vault Folder, Import Note and both
writers get **Open in Obsidian**: `obsidian://open?vault=<basename of the vault
path>&file=<vault-relative, URL-encoded, no .md>` via `openExternal` (no new capability;
backslashes → `/`). A `solenoid://` deep link back is HOLD until a caller exists.

**E. Watch → refresh.** The Stage-0 watcher (`21-collaboration.md`) gains two clients: a change
under a Vault Folder's `folder` bumps its connection token (`refreshConnection`); a change to
an Import Note's file calls its `reload()` (I); both debounced a second. `refreshMinutes` is
the stopgap on both. Closes `../deferrals.md`'s "auto-reload" item.

**F. TaskNotes.** Read through the **HTTP API**, not the files: field mapping, recurrence
expansion and `timeEntries` totals are plugin logic (`../out-of-scope.md` §6), and
`timeEntries` is the nested block shape the parser can't read. A over the tasks folder is the
vault-closed fallback. One connection node **TaskNotes** with a provider selector (Settings:
`taskNotesUrl` default `http://localhost:8080`, `taskNotesToken`; `http://**` already
allowed). **Tasks** → one `cube`: `path · title · status · priority · due · scheduled ·
timeEstimate · trackedMinutes · archived` + user fields as scalars; `projects · contexts · tags
· blockedBy` as list cells (`blockedBy` by task title); `timeEntries` (`start · end · minutes ·
description`) and `complete_instances` (`date`) as nested frames. **Calendar events** →
`frame` (`title · start · end · source`; `from`/`to` date inputs). **Stats** → scalars
(KPI-shaped). No time-entries provider: Unnest `timeEntries`; Cube Rollup (sum `minutes`) is
`trackedMinutes` recomputed. Pure core `taskNotesApi.ts` (paging + cube mapping over a fetch
stub; one fixture per endpoint). Ranked by what Bases cannot do:

- **F1 Schedule from dependencies.** Tasks → H6 (Duration = `timeEstimate` ÷ an hours-per-day
  literal) → `PUT scheduled` back (F6). Gate: the Track H pick; the feed ships without it.
  **Many projects:** by-row over the Projects frame, the tasks cube wired fixed, Filter
  (`projects contains`) inside the composite → H6; `Project finish` collects as a list, the
  schedules as a series that **Build Cube** stacks into one cube column. **Gantt in Obsidian
  for free:** H6's `gantt` output (Mermaid source) → Mermaid node → a Report ref → Write to
  Obsidian's fence, rendered natively; the 2.0 canvas Gantt is separate.
- **F2 Capacity and deadline probability.** GROUPBY due-week of `timeEstimate` minus calendar
  hours (H7 takes busy windows) → overload chart. Probability is **analytic**: a per-task
  spread column (user field, or actual ÷ estimate from F3 by project) → variance → summed along
  H6's `Critical` path (or all tasks for effort) → `NORM.DIST(deadline, mean, sd)` in an
  Expression. Monte Carlo fits where the uncertainty is one scalar (a composite around H6
  with an uncertain effort-multiplier port → `Project finish` mean ± sd). Per-row uncertainty
  proper is `12-value-model-extensions.md` #21. An **Alert** on the overload count or the
  probability makes a vault edit (via E) a toast + HUD entry. `timeEstimate` stays plain
  minutes (no time dimension in the unit lattice; an FC formats it).
- **F3 Time analytics and billing.** PIVOTBY week × project, Window running totals, actual ÷
  estimate per project as calibration; join a rates frame → an invoice Report → Write to
  Obsidian (C, into the client's note).
- **F4 "What next" via Decision Matrix.** Criteria from the row (priority, days-to-due,
  estimate, a user field); write `score` back (B, or F6); a Bases view sorted by it is the list.
- **F5 Recurrence adherence.** Unnest `complete_instances` → Window (lag) for streaks, GROUPBY
  for completion rate → heatmap.
- **F6 Write Tasks** (sink, Run-button only, Preview + `plan` like B): rows → `POST /api/tasks`
  (new) or `PUT /api/tasks/:id` when the row carries `path`; field mapping honoured, webhooks
  and workflows fire because the plugin writes; a single `text` column may use
  `/api/nlp/create`. List cells → the API's arrays.

**Out:** timer / pomodoro control, kanban or calendar rendering.

**G. Webhook → recompute — HOLD.** No listener in the desktop app. Options: a localhost route
in the Tauri shell (verify HMAC, bump a token), or the reverse via J. E covers file-backed
reads; revisit if F's API reads need push.

**H. mdbase query passthrough — HOLD.** Shelling out to the native `mdbase … query` binary:
beta, undocumented JSON shape, no `tauri-plugin-shell`, and Filter/Sort cover the `where`.
Revisit at mdbase 1.0 (`../decisions.md` mdbaseCeiling — the ceiling covers type-file writing too).

**I. Import Obsidian Note stays a Note.** Its value is the per-key sockets + `document` output
+ rendered body (a connection node emits one table). It gains: `refreshMinutes` (the
component runs the same `setInterval` → `reload()` the sources use), the watcher hook (E),
and a per-node `vault` like A's.

**J. Headless seam.** Connection nodes fetch through the Tauri bridges, so under `run-graph`
they emit nothing. The pure cores take files / responses as data; the runner supplies a
provider: `run-graph <graph> --vault <path>` (Node `fs` → Vault Folder / Import Note),
`--tasknotes <url>` (Node `fetch`), and `--run <node name>` arms and runs ONE named sink — the
Run button's headless equivalent (`sinkRunButtonOnly` gains that clause). Makes an
Obsidian-triggered recompute real without a listener (a `tasknotes-workflows` step or a Shell
Commands hotkey), and lets `vaultCube.test.ts` run the real node over `fixtures/vault/`.

**R. Relative dates, on top of `relativeDatesOptIn`.** Nothing here stores a relative date.
- **R1 One template grammar, Obsidian's:** `{{date}}`, `{{date:FORMAT}}` (moment tokens =
  Solenoid's `formatDateSerial` set), offsets `{{date+7d}}` / `{{date-1w}}` /
  `{{date+1m:YYYY-MM}}` (ours), `{{name}}`, `{{doc}}`; `{{today}}` is an alias of `{{date}}`.
  Resolves against the writer's optional `date` input when wired (a Date Input, `TODAY()+7`
  from an Expression, a column in a by-row composite), else the wall clock at Run — a file
  name is not a stored date and Run is explicit. Pure `nameTemplate.ts`.
- **R2 `{{daily}}`** = the day's note path from the Daily notes settings (`folder`, `format`);
  `{{daily+1d}}` tomorrow's; defaults vault root + `YYYY-MM-DD`. Periodic Notes (`{{weekly}}`,
  `{{monthly}}`) is v2.
- **R3 The date out of the file name:** A's `nameFormat` (defaults to the daily-notes format
  when `folder` is that folder) parses `name` into the `date` built-in (null on no match) —
  daily notes with `mood · sleep · weight · exercised` properties become a time series (Window,
  streaks, GROUPBY week, heatmap).
- **R4 "Due in the next 7 days" needs no syntax:** an Expression `TODAY()+7` into Filter's
  value (deterministic per pass, no opt-in), or a Date Input reading `in 7 days` under the
  setting. Filter's value field stays literal.
- **R5 Midnight rollover:** one timer to the next local midnight calls `requestRecalc()` (the
  F9 path) so TODAY / NOW recompute and relative Date Inputs re-resolve and fire their "day
  moved" Alert; armed only while the document contains a TODAY / NOW / relative Date Input
  (`volatileDates.ts` scan at load and on topology change). No setting.
- **R6** is B's timestamp rule above; F6 needs nothing (the API does it).

**K. Graphs as notes — HOLD.** The text form is line-oriented and byte-stable; a document could
live in the vault as `Solenoid/<name>.md` with the graph in a fenced block and the sidecar in a
second — linkable, synced, listed by Bases; D's stub becomes the document. Reopens the save
format (`../2.0-plan.md` P1) and is Stage 0 by another door; revisit when P1 lands.

**Not doing.** `.canvas` export (`canvas-bases` exists; a graph is computation). Reading a
`.base` as A's query (means evaluating Bases expressions; A + Filter is the honest scope).
The Bases formula language (one formula surface; Excel parity is the contract) and view
types (display). mdbase views, actions, CloudEvents, hosted Connect. Wikilink resolution in
Note bodies and the `![[Note]]` transclusion switch — polish after C. Bases' missing footer
stats (Range, Stddev, Earliest/Latest, Checked/Unchecked) — `../backlog.md`, not a vault item.

## Node specs (catalog rows a build session writes; DESIGN.md §7 voice)

| Node | Kind · menu | In | Out | Init (persisted) | Pure core · test |
|---|---|---|---|---|---|
| Vault Folder | connection · Connections | — | `cube` ("Notes") | vault, folder, glob, includeBody, nameFormat, refreshMinutes | `vaultCube.ts`, `mdbaseTypes.ts`, `obsidianTypes.ts`, `dailyNotesConfig.ts` · `vaultCube.test.ts` over `fixtures/vault/` |
| Filter / Sort / Head / Distinct / Get Row (exist) | passthrough | table input → `cubeIn` | adopts: cube in → cube out | Filter: `contains` / `contains any` / `contains all` / `is empty` | `selectCubeRows` in `frame.ts` · `cubeRowVerbs.test.ts` |
| Get Column / Decision Matrix / H6 (exist) | — | table input → `cubeIn` | unchanged (list / ranking frame / the cube + 4 columns) | — | same test file |
| Write Properties | sink · Connections | `cube` (frame widens) | `plan` frame | vault, keys, addMissing, stamp, writeBase | `frontmatterPatch.ts` · `frontmatterPatch.test.ts` (untouched bytes identical; cube → vault → cube equal) |
| Write to Obsidian (exists) | sink | `document`, optional `date` | — | + mode, fileName / subfolder templates | `managedBlock.ts`, `nameTemplate.ts` · tests per item |
| TaskNotes | connection · Connections | `from`, `to` (Calendar only) | Tasks `cube` · Calendar `frame` · Stats scalars | provider, refreshMinutes | `taskNotesApi.ts` · `taskNotesApi.test.ts` (fixture per endpoint) |
| Write Tasks | sink · Connections | `cube` (frame widens) | `plan` frame | mode (create / update), keys, stamp | shares `taskNotesApi.ts` |
| (app) midnight rollover | — | — | — | — | `volatileDates.ts` + one timer → `requestRecalc()` |
| (CLI) `run-graph --vault --tasknotes --run` | — | — | — | — | `run-graph.test.ts`: a vault-fixture case, a `--run` case on a temp copy |

Every writer: `enabled` out of the persistence whitelist (loads disarmed, the
`WriteObsidianNode` pattern), status line + Preview + `plan`, `socketDocs` say "wiring never
writes". Every reader: background fetch, sync `data()`, a `#VALUE!`-class error with the
reason in the status line on an unreachable vault / port (a 401 reads "token"), never a throw.

## Seeds

Seeds load on web with no vault, so each ships a **Frame Input snapshot of the feed's scalar
columns** ("replace me with a TaskNotes node"; the row verbs take the nested shape when a
real feed replaces it): **"Which task next?"** (F4: 12 tasks → Decision Matrix → Score → bar
chart, a disarmed Write Properties at the end) and, when H6 lands, **"Kitchen remodel from
TaskNotes"** (H6's seed on the tasks shape). `decision-matrix.json` stays the "vault as a
source" demo.

## Rules touched (cite in commits)

`sinkRunButtonOnly` (every writer; J adds "or the CLI's explicit `--run <name>`"),
`noDataInComponents` (Preview is a pure plan over the cached cube + reads), `retypeReconciles`
avoided (one `cube` output; A′'s adoption is derived state, never persisted), `onePrunePath`
untouched, `relativeDatesOptIn` untouched (R), a new **`onePatchPath`** candidate
(`frontmatterPatch.ts` is the only writer of a note's YAML; `obsidianWrite.ts` writes whole
documents). The fs allowlist gains `.yaml`/`.yml` read (one capability line, noted in
`../architecture.md`'s desktop section).

## Sequencing

A′ → A (+R3) → B → D → C (+R1/R2) → F (feed + F4/F3/F5 + F6) → I → J → E; R5 any time; F1
when H6 lands; G, H, K on hold. A′ first: a cube nothing can filter is not a product. A alone
is a product ("your vault as a table"); A + B is the loop ("compute in Solenoid, see it in
Bases"); F is independent of B and C.

## Defaults (standing in for author calls — no strong opinion, 2026-09-06)

1. Vault binding is **per node**, defaulting from the setting; the setting stays the default
   and the Import Note's root.
2. Typing sources in the order **mdbase → `types.json` → guesser**.
3. Property writes **patch YAML** (B); the API (F6) is the path for task notes. B refuses a key
   it can't patch; F6 refuses an update row without `path`.
4. **F ships as feed + F4/F3/F5/F6 without waiting on H6**; `blockedBy` is emitted from day one.
5. `includeBody` **off**; `stamp` **off** everywhere, opt-in (author 2026-09-07): the toggle
   stays on the card and, when on, Preview names the `Solenoid/<doc>.md` stub before Run;
   `writeBase` **off**.
6. Import Note **stays a Note** and borrows the refresh timer + watcher hook.
7. Readers emit **one `cube`**, the row verbs take it, writers take `cube`, a sink's preview is
   a **`plan` frame**.
8. Relative dates live in **templates and Date Inputs only**; Filter's value stays literal.

## Rejected shapes (the relapse guard — each would reopen a ruling above)

A `frame` twin output on each reader (hides the cube→frame step the lattice insists on;
doubles socket docs). A **Flatten** node with a rule menu (existed only to reach frame-only
verbs; A′ is the answer). Import Note as a connection node (loses its per-key sockets). Monte
Carlo over a per-row spread column (the run mode samples scalar ports only). By-row over a
cube (it iterates frames and lists). An invisible-character escape for `%%` in managed blocks
(refuse instead). A provenance stamp on every patched note (noise in every Bases view). A
Solenoid-authored mdbase type file or a blended Solenoid + TaskNotes schema shipped by the app
(mdbaseCeiling: the schema is the user's; Solenoid reads and validates, never authors).
"Never write `.base`" (the format is small and official; `writeBase` gives a live table).
Reading a `.base` as the reader's query (a second expression language). Relative text in
Filter's value field (moves the opt-in to parser call sites). Dotted `file.*` column names
(bracket form in every formula). A separate time-entries provider (Unnest does it).

## Risks

mdbase breaks by policy before 1.0 — pin the `spec_version` read; unknown → fall back to
`types.json` / guessing, never refuse the folder. TaskNotes' API is opt-in; port and token are
Settings, not discovery. The allowlist needs `.yaml`/`.yml`; a vault outside `$HOME` needs a
capability change (document, don't widen to `**`); two dot-folder reads (`types.json`,
`daily-notes.json`) need the glob verified. Writes touch the author's notes: Preview + atomic
writes + line-level patching that never re-serializes + untouched-bytes tests are the whole
safety story; each pure core gets its fixture test before a node exists. Large vaults: the
walk is depth-6 and unindexed, the cube is eager JS memory, A re-reads every matched file per
refresh — fine to a few thousand notes; `modified` is the key for a later mtime cache.

## Sources (read 2026-09-06)

- Obsidian: https://obsidian.md/help/properties · https://obsidian.md/help/bases/syntax ·
  https://obsidian.md/help/bases/functions · https://obsidian.md/help/bases/views ·
  https://obsidian.md/help/plugins/daily-notes
- TaskNotes: https://github.com/callumalpass/tasknotes · https://tasknotes.dev/HTTP_API/ ·
  https://tasknotes.dev/webhooks/ · https://tasknotes.dev/developers/specification/ ·
  https://github.com/callumalpass/tasknotes/releases
- Companions: https://github.com/callumalpass/tasknotes-workflows ·
  https://github.com/callumalpass/canvas-bases · https://github.com/callumalpass/tasknotes-app
- mdbase: https://github.com/mdbase-dev/mdbase-spec · https://github.com/callumalpass/mdbase ·
  https://github.com/callumalpass/mdbase-cli (archived) ·
  https://github.com/mdbase-dev/mdbase-connect · https://github.com/mdbase-dev/mdbase-obsidian ·
  https://github.com/callumalpass/mdbase-tasknotes
