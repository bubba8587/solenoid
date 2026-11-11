Solenoid 1.6.1

Pivot calculated fields, retuned themes, the GPU renderer on Chrome's stable API, and a card for editing any table by hand. Runs free in your browser at solenoid-ngc.com; the Windows exe, the Linux AppImage and the .deb are below.

Highlights

- PIVOTBY calculated fields: name a field and give it a LAMBDA over columns, like `SUM(Miles) / SUM(Gallons)`. Every cell, subtotal and grand total runs it on its own rows, so a ratio stays right at every level instead of averaging row ratios. See the Pivot calculated fields example.
- The Pivot view grew up.
  - A right-click menu edits the Pivot from the table.
  - Each field header has a sort and filter button; a filtered field shows as a chip.
  - Filters list every value, searchable, and dates by year and month.
  - Group a date field by years, quarters, months, weeks or days.
  - A value's number format, from the view's menu.
- Updated theming.
  - Orchard's light mode keeps its warm ground under a blue, pink or violet accent instead of washing pastel, and its amber is a clear burnt orange.
  - Dawn and Dusk's light ground is a pale apricot instead of lime.
  - Blueprint's dark mode keeps warm accents from muddying the ground.
  - In the Obsidian look, accent-colored text reads brighter in dark mode.
- The HTML-in-Canvas GPU renderer (Settings, Renderer) runs on Chrome's shipped API: no flag from Chrome 157.
  - It stays on the canvas after a pan or zoom instead of swapping back to the page, which made zoomed-in panning slow.
  - Cables, ribbons, Conduits and standoffs are drawn on the canvas too, so nothing flickers on a zoom.
  - Captures render at 2.5x, so text stays sharp zoomed in.
  - Charts and figures redraw on the canvas when their data changes, and a selected card sits above its group.
- Edit Frame: change cells of any table by hand, even a computed one. Each edit is kept and listed as its own table, and with Key set it finds its row again when the table above changes.

Obsidian and files

- A note's body is data. Under From each note, Vault Folder can read each note's tasks (done, dates, priority and tags, in the Tasks plugin's and Dataview's forms), its tables, and Dataview's `key:: value` fields. Import Obsidian Note gives a note's tasks and tables as outputs.
- Vault Folder has a Backlinks column: the notes that link to each note.
- LINKNAME and LINKPATH read the note a link names.
- Write to Obsidian can tick or untick checklist items, changing only that mark in the note. Reading a folder and writing it straight back changes nothing.
- Local File reads a whole folder, like Power Query's From Folder: a name like `monthly/*.csv` loads every matching CSV or Parquet file as one table, with a File column naming each row's file. `**/` reaches into subfolders.
- Each file can go through the same steps first: Local File's Files output has a row per file, a Composite set to For each runs once per file, and Append stacks the results.
- Local File's picker lists files in subfolders.
- Join takes a Cube and carries its lists and tables.

Dates

- A date order (MDY, DMY or YMD) on every card that reads dates from text, and DATEVALUE takes one.
- Local File reads a CSV's dates in its order, and the Frame popup honors it.
- Local File and Web Source pick their column types in their popups' headers.
- Typed relative dates like `+3 days` or `-2 weeks` read as dates.

Cards and formulas

- A table (an HSTACK or a matrix) wired into a Chart plots its columns instead of an empty chart.
- A blank between commas in a List Input row stays as a blank item.
- A Composite's For each mode (formerly By row) runs Live or on Solve, and says how many passes it ran.
- A column name that's off only by letter case says so.
- The SUMX2 family counts logicals.
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

- A running or sliding sum no longer stays infinite after a huge number leaves its window.
- Replace Values writes NaN for a replacement its column can't read.
- A marker a drill-in undo or redo brings back gets its port again.
