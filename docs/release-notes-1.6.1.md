Solenoid 1.6.1

Pivot calculated fields, retuned themes, the GPU renderer on Chrome's stable API, and a card for editing any table by hand. Runs free in your browser at solenoid-ngc.com; the Windows exe, the Linux AppImage and the .deb are below.

Highlights

- PIVOTBY calculated fields: a formula per field, like `Profit / Sales`, worked out over each cell's own rows rather than by summing a column. See the Pivot calculated fields example.
- The Pivot view grew up.
  - A right-click menu edits the Pivot from the table.
  - Each field header has a sort and filter button; a filtered field shows as a chip.
  - Filters list every value, searchable, and dates by year and month.
  - Group a date field by years, quarters, months, weeks or days.
  - A value's number format, from the view's menu.
- Updated theming.
  - Orchard keeps its warm ground under any accent, and its amber is a clear burnt orange.
  - Dawn's light ground is a pale apricot instead of lime.
  - Blueprint's dark mode keeps warm accents from muddying the ground.
  - Links in dark mode read brighter.
- The HTML-in-Canvas GPU renderer (Settings, Renderer) runs on Chrome's shipped API: no flag from Chrome 157.
  - It holds the canvas at every zoom instead of handing back to the page after each gesture.
  - Cables, ribbons, Conduits and standoffs are drawn on the canvas too, so nothing flickers on a zoom.
  - Captures render at 2.5x, so text stays sharp zoomed in.
  - Charts and figures redraw on the canvas when their data changes, and a selected card sits above its group.
- Edit Frame: change cells of any table by hand, even a computed one. Each edit is kept, listed as its own table, and finds its row again by a key when the table above changes.

Obsidian and files

- A note's body is data. Vault Folder can read each note's tasks (done, dates, priority and tags, in the Tasks plugin's and Dataview's forms), its tables, and Dataview's `key:: value` fields; Import Obsidian Note gives a note's tasks and tables as outputs.
- Vault Folder has a Backlinks column: the notes that link to each note.
- LINKNAME and LINKPATH read the note a link names.
- Write to Obsidian can tick checklist items, and never copies body data into properties.
- Local File reads a whole folder: a name with `*` loads every matching file as one table, subfolders included.
- A folder's files can each go through one transform: a Files output, By-Row over each file, Append stacks the results.
- Join takes a Cube and carries its lists and tables.

Dates

- A date order (MDY, DMY or YMD) on every card that reads dates from text, and DATEVALUE takes one.
- Local File reads a CSV's dates in its order, and the Frame popup honors it.
- Local File and Web Source pick their column types in their popups' headers.
- `+3 days` reads as a date.

Cards and formulas

- A Chart plots a table directly.
- List Input keeps a typed gap.
- By-Row runs live or on Solve, and says how many passes it ran.
- A column name off only by letter case says so.
- The SUMX2 family counts logicals.
- A sum past the largest double comes back exact.
- Get Column answers `#REF!` for a column the table lacks.

Canvas

- Align, Distribute and opening a card end with the No-Overlap Pass, which now runs inside a group too.
- Pivot fields drag again in the desktop app and in Firefox.
- Enter never commits while an input method is composing.

Examples

- A tiny transformer: an LLM's forward pass, built from table cards.
- Tasks joined to their projects.
- Pivot calculated fields: MPG by plate and month.

Fixes

- Replace Values writes NaN for a replacement its column can't read.
- A marker a drill-in undo or redo brings back gets its port again.
