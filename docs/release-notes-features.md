# Solenoid 1.4.1: feature highlights (selling list)

Curated, high-value features that will sell 1.4.1: the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as features land; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.
The bar for what earns a spot: `archive/release-notes-1.1.md` (a sell is a shiny thing
a user will go discover and play with, or something that would inspire a download;
What's New is not a changelog, GitHub is). There is no install base yet (author
2026-08-28): novelty *versus the last release* counts for nothing, only the bar above
makes something a slide. **The 1.4 list shipped with v1.4.0 and lives in git history**
(`git show v1.4.0:docs/release-notes-features.md`); this file covers everything on
`develop` since that tag.

## Headliners: the slide deck

- **[slide] Linux desktop.** The desktop app runs on Linux as well as Windows, with the
  same native Polars engine, vault access and local files. Releases carry an AppImage
  (download, mark executable, run) and a `.deb`. The window draws its own controls and
  resize grips, and the canvas stays crisp through zoom on WebKitGTK.
- **[slide] Formula columns in a Frame Input.** A column's type cycle ends on **Fx**:
  the column becomes a formula over the row (`@qty * @price`), typed where the data is.
  A Frame Input's λ inputs are named in it (`λ1` binds by name, `λ1(@a, @b)` calls it),
  and a formula that returns a date stays a Date column with no type pick
  (`@start + 7`, `TODAY() + 7`).
- **[slide] Obsidian markdown in notes.** Note, Import Obsidian Note, the Report preview
  and the webpage export render what Obsidian writes: `[[wikilinks]]` as links, `#tags`
  as chips, `> [!callouts]`, `==highlights==`, `$math$`, with `%% comments %%` and
  `^block-ids` hidden. A note imported from a vault reads the way it does at home.
- **[slide] Solenoid Properties, an Obsidian plugin.** List, Matrix, Frame and Cube
  property types for Obsidian: a property shows as the chip Solenoid draws for it, opens
  in Solenoid's table editor and stays plain YAML in the note. Solenoid reads what it
  writes. Listed in Obsidian's community plugins:
  community.obsidian.md/plugins/solenoid-properties (0.1.0).
- **[slide] Table editing.** The table popup's Form and CSV views edit in place, in both
  Source and Formatted modes. The cell being edited gets a calendar for a date and a
  checkbox for a Boolean, and a text cell suggests the values already in its column.
  The column header is one row: type, name, format and sort.

## Release-notes body

- Computed columns are marked in the Form and CSV views; the CSV view refuses ragged
  text while the table has one, and the CSV writer quotes any field that needs it.
- Only the sort button sorts: a column header is no longer a click target in the table
  or cube popups. A column's format picks open from its paintbrush.
- Cube popup: a list level lies across one row (a list is a CSV row) with a Row | Column
  switch; returning from a drilled level lands on the cell you came from; nested chips
  tint by element family and a list chip's hover shows its first items.
- Shapes read the same everywhere: `4× List`, `3×2 Frame`, `3×2×1 Cube`.
- Frontmatter reads any YAML and writes Obsidian's block style, so a property edited in
  Obsidian round-trips. A date list in a note reads as a date list.
- Knap inside frontmatter: a quoted tag's socket carries the rendered value.
- Working in Obsidian no longer interrupts Solenoid: the vault file watcher is gone and
  Refresh re-reads. Import Obsidian Note reloads on Refresh all connections, and its card
  takes the note's own heading as its title.
- The Report previews a wired template with no records.
- Families renamed: Distributions, Sets, Chart (Recharts).
- Chrome icons are drawn as SVG, not font characters.
- The demo vault wears Solenoid's palette in Obsidian (a CSS snippet, light and dark)
  and carries a planning canvas.
- The marketing site's download button names your platform.

## Under the hood: seed list for the GitHub changelog

- CI builds the desktop app for Windows and Linux (`desktop-build.yml`); a release
  publishes only when both pass.
- Dev tooling runs on Linux: no PowerShell, one browser resolver, and `release:desktop`
  fails the build if the binary carries the builder's home path.
- The frontmatter reader is the `yaml` package; the hand-rolled subset parser is gone.
- The desktop fs scope names `.obsidian` literally (on Unix `**` skips dot-directories).
- The decision tree: citations are `[[ID]]` wikilinks, the author's Obsidian edits reach
  agents through the vault outbox, coverage is pinned at 100%, and the mechanics docs
  are the `specs/` layer with three floor specs.
- The Obsidian plugin builds from the app's own components behind a list of module
  shims; `test.yml` builds it on every push.
- rustls 0.23.45 (RUSTSEC-2026-0285).
