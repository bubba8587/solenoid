# Solenoid 1.4 — feature highlights (selling list)

Curated, high-value features that will sell 1.4 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as features land; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.
The bar for what earns a spot: `archive/release-notes-1.1.md` (a sell is a shiny thing
a user will go discover and play with, or something that would inspire a download —
What's New is not a changelog; GitHub is). There is no install base yet (author
2026-08-28): novelty *versus the last release* counts for nothing — only the bar above
makes something a slide. **The 1.3 list shipped with v1.3 and lives in git history**
(`git show v1.3:docs/release-notes-features.md`); this file covers everything on
`develop` since that tag.

## Headliners — the slide deck

- **[slide] Your Obsidian vault is a table.** Point Solenoid at a vault and the Vault
  Folder node reads a folder of notes as one cube: every frontmatter property a column,
  the note body included when you ask, a glob to scope it. Filter, group, chart and
  compute over your notes like any other data — then write back. Write to Obsidian is
  the one sink: a Document becomes a note (overwrite, append, or a block), a cube of
  rows becomes each note's frontmatter, both with a Preview before Run. Import Obsidian
  Note reads one note's properties as sockets; paths and titles are wireable values, so
  a reader's output drives a writer's target. A bundled demo vault means the web app
  shows all of it with no vault of your own.
- **[slide] TaskNotes, live.** The TaskNotes node feeds your tasks (a cube), calendar
  (a frame) or stats straight off the plugin's API; Write Tasks sends rows back as new or
  updated tasks. The "Tasks from TaskNotes" and "Kitchen remodel" examples plan a week from
  a real task list.
- **[slide] Reports are templates.** Note and Report bodies speak Knap, Obsidian's
  template language: `{{ name }}` embeds a wired value as the canvas shows it, `{% if %}`
  and `{% for %}` build the prose, and a wired template note supplies the text with its
  variables as sockets. Wire a frame into Records and the Report is a mail merge: one page
  per row, one note per page when written to the vault. The Personal Finance letter's
  verdicts flip as a slider moves.
- **[slide] Schedules and Gantt charts.** The Schedule node runs a real critical-path
  pass over a task table: durations in working days or minutes, weekends and holidays,
  typed links with lag and lead, phases that roll up, a status date for percent complete,
  float, the driving predecessor, and plain-named diagnostics. The Gantt figure draws it:
  brackets for phases, diamonds for milestones, deadline pennants, a baseline ghost, split
  bars for out-of-sequence progress, a month calendar layout, and a popup with a keyboard
  tree grid. Local File imports a Microsoft Project XML, GanttProject or Primavera XER plan;
  the Report exports the figure to a webpage or a vault note.
- **[slide] Everyday sources.** Weather (Open-Meteo), Geocode, Holidays (Nager.Date),
  Currency (Frankfurter, the target currency forwarded as a unit), Time Zone Convert,
  World Clock and QR Code: the nodes that make a document worth leaving open. Foreign
  documents load with the network quiet until you allow it, once, per document. The
  Garden Dashboard example wires Geocode into Weather and totals the rain either side
  of today.
- **[slide] Planners.** Payoff Planner rolls a debt list month by month, avalanche or
  snowball, with the freed payments cascading; Group Cost Settle turns a shared-expense
  ledger into who-owes-whom, by totals or by transaction; Earned Value scores a plan
  against a status date. The Planners example shows the first two.
- **[slide] Categorical columns.** Pick Chip on a text column and its distinct values
  become tinted chips in the table popup and on the Format Controller; entry on that
  column offers the existing values instead of a blank field.
- **[slide] Peek any socket.** Hover an output socket and a scaled-down live Display of
  its value appears: a frame, a cube, a list, a chart, a diagram, without wiring anything.
- Free-drawn cables: point-by-point annotation curves in the wired cables' three shapes,
  with arrowheads, width, color and a 45° angle dial per point (Insert → Draw a cable).

## Release-notes body

- Cube Input is the fourth literal source: a nested table edited in one popup that
  drills through every level. List Input opens the ordinary list popup.
- The row verbs (Filter, Sort, Take, Unnest, Get Column, Join, Group by) take cubes as
  well as frames; Unnest explodes a list column; Decision Matrix and Schedule take a cube.
- Records: gallery size presets, an indented List view, `#field` title rows, a clamp;
  a table popup's frozen header and type-aware summary footer; arrow-key row navigation
  in the record popup; the shared column picker on Sort, Get Column and Join.
- Finance cards merged the Set-card way: Discount Security, Accrued Interest, Bond
  Pricing, Payment Breakdown (IPMT / PPMT and the cumulative pair on one card).
- Per-element mixed-unit trig: a list mixing degree-tagged and radian cells reads each
  cell in its own unit; the Triangle Solver reads any angle unit.
- Chart Builder covers Gantt (timeline and calendar option sets) and Record; pie labels
  redrawn with a two-segment leader and an inside placement; a family filter on the
  Chart type picker; Gauge is one node with a Dial | Bar switch.
- Timesavers: Fiscal Quarter start, Age, Nth Weekday.
- Flip a node's sockets left-to-right; lock a group's position so Tidy and Cleanup route
  around it; pop-ups resize from a grip; header title case is a setting.
- Formulas: a blank argument slot is Excel's blank (`TEXTJOIN(",",,…)` keeps the
  empties); GCD / LCM / MULTINOMIAL / PERCENTRANK and the workday trio take their list
  whole; WORKDAY.INTL takes a weekend mask; SUBSTITUTE truncates its instance like Excel.
- The Add menu gained Docs & Files, Obsidian and Plan groups; the Examples menu groups
  its seeds; Help ▸ Solenoid website.
- The marketing site: Obsidian, Examples, Packs and Download pages on real canvases.

## Under the hood — seed list for the GitHub changelog

- Every rule and settled decision is a node in the DTE tree (`decisions/`, 168 nodes);
  rules.md and decisions.md are retired; code and tests cite `dte:<ID>`.
- The scheduling engine and Gantt figure are in-repo packages (`packages/`).
- Tidy reserves a plain card's measured box, not its declared size.
- The Input Switch's mode change ghosts the cables it drops and reattaches them on the
  flip back, drawn dashed while pending.
- Dependencies walked: vitest 5, React 19.3, Vite 8.3, React Flow 12.11, TypeScript 7;
  mermaid held at 11 (chevrotain's lodash-es advisories).
- Undo never flashes the load curtain; the copy-edit overlay preserves rendered markup.
