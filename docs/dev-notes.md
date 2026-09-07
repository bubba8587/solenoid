# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-07e — Gantt research: the landscape, the spec, the separate-repo plan)

The author asked for a big outside-in research pass on Gantt and project-planning software, not
built on the existing Schedule node: which open / free / embeddable libraries exist, whether one
standout repo should be adopted or matched, and whether a separate repo combining the best of the
mid-tier ones is the right call. Six research passes (libraries; scheduling semantics, engines and
formats; open-source and data-first apps; commercial benchmarks and UX; text and plotting
approaches; library internals and headless precedents) landed in **`v2.0/25-gantt.md`** (PROPOSAL,
Arc 8). Verdict: no permissive repo to adopt whole (every vendor's seam is "anything that computes
dates"); the standout to match is Microsoft Project's semantics with MPXJ's `MicrosoftScheduler` as
the open oracle and Project-authored MSPDI files as golden tests; recommend a separate MIT headless
toolkit (`schedule-engine` · `gantt-layout` · `gantt-dom` · `gantt-react` · `project-io`) that
Solenoid binds through a Plan node family and a `chart`-socket Gantt figure. Findings that matter:
DHTMLX 10 relicensed to MIT with readable sources (its scale manager and link router are
vendorable); SVAR is a hand-written React mirror over a framework-free MIT store; Huly carries the
one modern TypeScript CPM core (EPL, read-only); the consumer "auto-shift" switch dissolves in a
pure-function model (gap = lag, typed date = SNET, manual = flag); Excel serials are already the
zone-less day representation a scheduling engine wants. Ten author calls in the doc's § 10; the
"no bar editing" ruling stays the default until its phase 5.

### SESSION DIGEST (2026-09-07d — the pitch read: the Obsidian + TaskNotes surface verified, the mdbase ceiling)

The author is writing the pitch copy and asked for the integration surface as it stands, verified
against `develop` (a stale local `develop` was three days behind origin; hard-reset). The surface
matches `node-coverage.md` § Connections & sinks and the per-item entries — nothing to correct in
the code; the reading is the pitch's fact sheet. Doc drift fixed: the bundle doc's § What stands
today still listed the stub note, mdbase validation, `writeBase` and the F1 seed as open (all
landed, per the code and the 09-07b digest), and two node-coverage "Not yet" clauses (the stub
note, Write Tasks) pointed at items that had landed in the same file. **mdbase ruling**
(decisions mdbaseCeiling): mdbase is an optional schema beside the notes, not TaskNotes' storage;
what stands (schema-first typing in Vault Folder, refuse-on-violation in Write Properties, silent
fallthrough) is the whole integration — no type-file writer, no query passthrough, one clause in
the pitch. A blended Solenoid + TaskNotes `_types/` schema is the user's to write and works today;
untested: how mdbase resolves two types matching one glob, and whether a TaskNotes upgrade
rewrites its shipped type file. Not-to-claim list for the copy: no `![[Note]]` transclusion on
write (inlined; deferrals), no `/api/nlp/create`, checkbox ticks in an imported note never write
back, nothing runs in the browser build.

### SESSION DIGEST (2026-09-07c — the new nodes' formula surface + the Add menu after the bundle)

**Formula surface:** of the nodes the Obsidian / Track H / C1 sessions added, only Time Zone
Convert is a scalar function both surfaces can hold, so it now registers as `TIMEZONECONVERT`
(the node's own `convertZone`, node↔formula agreement pinned in `timeZone.test.ts`; `timeZone.ts`
imports the frame TYPE only, so the rete-free walk stays clean). Everything else is excluded by
the parity rule itself, not by omission: Geocode / Weather / Holidays / Currency / Vault Folder /
TaskNotes are sources, the Write nodes are sinks, QR Code and World Clock are figures, and
Allocator / Schedule / Payoff Planner / Group Cost Settle are frame verbs (frames stay out of
formulas — matricesInFormulas). Node → formula stands at 100% of in-scope leaves.
**Add menu:** the bundle had pushed Connections to 16 flat rows (the panel scrolled) and Analyze to
9. Connections is now sources → an Import HTML / XML pair → Write File → the keyless lookups as
two pairs (Geocode · Weather, Holidays · Currency) → an **Obsidian** submenu holding the six vault
nodes; the four planners moved from Analyze to a sibling **Plan** submenu (rows in, a plan out);
Cube Input joined the literal sources in Input under Frame Input (frame accent) instead of the
Cubes submenu; COMPLEX · LAMBDA and Append · Bind Columns pair up so Input and Table verbs stay at
the validator's soft row max. Every new node ranks first for its obvious search word. Still over
the soft max, unchanged: Date & Time (17 rows, five of them pack rows appended after Save Times)
and Visuals (QR Code lands after the sub-categories) — pack placements push to the end of a
category, so a pack leaf always trails the core rows; a fix would be an insertion policy in
`catalogUtils`, not a catalog edit.

### SESSION DIGEST (2026-09-07b — three agents: the Obsidian bundle lands, Track H, the Cube Input editor)

**Obsidian + TaskNotes** is the author's adoption bet (backlog § Obsidian + TaskNotes). Landed
across the three agents, ledger in the bundle doc's § What stands today: A (Vault Folder → cube),
A′ (row verbs take cubes, `recordsToCube` the one rows-of-objects → cube shape), B (Write
Properties with plan / Preview / Run + mdbase validation), C (widgets), D (Open in Obsidian, the
graph stub note + `solenoid:` backlink), E (vault watch), F (TaskNotes node: tasks / calendar /
stats; Write Tasks), F6, I, J, R5, the Weather and Holidays nodes, the headless `run-graph`
seam (`FsProvider` + `--vault` / `--tasknotes` / `--run`). Seeds: vault-as-a-table,
kitchen-remodel-tasknotes, garden-dashboard, which-task-next. **Track H**: Payoff Planner (H1),
Group Cost Settle (H3), the hours allocator seed (H3.5), Schedule (H6) over a tasks CUBE — the
author's ruling that nothing is designed around an in-cell string list. **Cube Input** is the
fourth literal source; its popup edits every level in ONE window (drill, never a popup above a
popup), and List Input got the same popup (subsystem-invariants § Literal input editors).
**Review pass** (author: "so much added, all three go and review"): the error guard now passes a
THROWN SolError through with its code (a Filter on an empty frame read `#ERROR! [object Object]`);
the Schedule catalog copy caught up with list-cell Predecessors; seed note copy fixed
(trip-split's escaped newlines, remodel-gantt's repetition). Peers' findings: be stripped agent-speak from four demo notes, made Vault Folder's folder the same subfolder dropdown Write to Obsidian uses, and the stamp (Link to graph) is now OPT-IN by the author's ruling (Preview names the `Solenoid/<doc>.md` stub when on); fe folded doubled parentheticals in Schedule / Allocator socketDocs, made Payoff's order picker a SegToggle, kept the chip on an empty Frame Input, and renumbered the seeds into group bands (Obsidian right after Start here). Open for the author: the Cube Input editor commits per cell while Table / Frame Input hold a draft with Save.

### SESSION DIGEST (2026-09-07 — Obsidian bundle 24 item A: Vault Folder → Cube)

A **demo vault** (`demo-vault/`, committed) is the single-source fixture + the author's eyeball
vault: an mdbase collection (Projects, list + nested-milestone cells), a plain Notes folder typed
via `.obsidian/types.json` + guesser, a daily-notes folder, TaskNotes-shaped tasks, People link
targets, one Bases view, wikilinks/embeds/tags. The pure-core tests read it directly (no
`tests/fixtures/vault/` mirror). **Item A shipped:** `vaultCube.ts` `notesToCube` → ONE cube, a
row per note: the Bases `file.*` built-ins + the frontmatter union; scalars typed, lists as list
cells, rows-of-objects as nested frames. Typing per key mdbase → `.obsidian/types.json` → guesser
widened across rows (`mdbaseTypes.ts` via the new `yaml` dep, `obsidianTypes.ts`, `vaultTypes.ts`);
ISO datetimes upgrade to fractional serials in the reader (kept local, noteFrontmatter untouched).
R3 `dateFromName` parses the file name into the `date` column; `dailyNotesConfig.ts` gives its
default format. `VaultFolderNode` (first cube-emitting connection node, Connections menu): desktop
-only local read (no C2 network gate), sync `data()` + a background read that walks up for
`mdbase.yaml`/`_types`, reads `.obsidian/types.json` + `daily-notes.json`, calls notesToCube;
per-node vault chip. `statVaultFile` bridge + `fs:allow-stat` / `.yaml` read for created/modified +
mdbase schemas (architecture.md desktop note). Left: the "Your vault as a table" seed (waits on
fe's A′ so the cube can Filter/Sort). Sequenced with fe (A′) and the Lead (F TaskNotes) on develop.
