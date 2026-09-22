# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-22b: the connective-core copy pass; author present, reviewing samples)

- **What stands:** the shipped copy is free of em dashes and `uiCopy.test.ts` enforces it over every genre,
  seeds included (DESIGN.md §7 now says so). Help tabs (`help.md`, `data-model.md`, `notes.md`), catalog
  descriptions, Inspector Excel notes, socket docs, tooltips and error messages along the computed-column,
  socket-lattice, unit-flow and type-propagation paths are rewritten in the author's register: short, plain,
  Excel names where they help, no wiring narration.
- **Facts corrected, not just reworded** (each verified against code): the help tab said a format resets at
  the first transform (it carries through meaning-preserving ops, [[D41]]); Saving said examples replace the
  canvas (they open as new documents) and only newer formats are refused (older are too); six Excel notes
  (ISNA, ISERR, ISTEXT/ISNONTEXT, MINVERSE, CONCAT/CONCATENATE) and the CONCAT description misdescribed the
  node; XLOOKUP's advice named Build Frame for pairing two lists (Frame from Lists does); node-coverage put
  `anydata` below `anytable` and said a computed column's formula sees only scalars.
- **Specs** `error-values`, `unit-flow`, `type-propagation…`, `socket-lattice`, `literal-input-editors` are
  restructured into sections; every spec header drops the "Lifted from subsystem-invariants" line.
  `mental-model.md`, `value-semantics.md`, `glossary.md` and all of `node-coverage.md` are reworked; build
  history goes to git.
- **DTE:** about 70 AI-made nodes reworded with rules unchanged, each with a History line; every `*Origin:*`
  paragraph and duplicate `*Why:*` label is gone; 56 bare rule names became `[[ID]]` wikilinks. Human-held
  nodes (A ring, B7, C80) were not touched; author quotes stay verbatim.
- **Open:** the before/after log for the author lives outside the repo (session scratchpad). The trailing
  parenthetical rule still covers only catalog, socket docs and Excel notes (279 sentence-level hits in seeds
  and catalog, mostly legitimate glosses).

### SESSION DIGEST (2026-09-22 — 1.4.2 and plugin 0.1.3 shipped: the look follows the palette and accent, the app reads the picks, a Save writes source text; author present)

- **1.4.2 SHIPPED 2026-09-22** (tag `v1.4.2` on `5d2bc6f1`: merged, bumped and tagged by the agent on the author's
  word; `desktop-build.yml` publishes the release on the tag). What's New and the selling list stay 1.4.1's (the
  author's call). **Plugin 0.1.3 is PUBLISHED**: the snapshot in `bubba8587/Solenoid-Properties` is the 1.4.2
  commit (`3458955` there, builds byte-identical to this repository's build), tag `0.1.3` pushed; the directory
  rescans it.
- **Releasing is the agent's, on the author's word, from the dev machine** (CLAUDE.md § Releasing, author
  2026-09-22): "the tag is the author's" was written for the cloud harness, where a tag push fails.
- **The Solenoid look wears the plugin's palette setting, not just the chips.** `look.css` authors no hex any
  more: `obsidian-plugin/src/lookTokens.ts` derives every color token from `palette.ts` exactly as the chips'
  sheet does (`themeVars`), the build appends one block per built-in palette and mode to `styles.css` under
  `body.solenoid-look.solenoid-palette-<name>`, and `main.tsx` swaps that class beside the look class (every
  window, settings included; `onunload` sheds both). Pure value swaps, author's word: the app already settled
  contrast, so the look's own ink/rule/wash formulas stand unchanged under every palette. The snippet stays
  the Default palette (rules + its two generated blocks; `look.test.ts` pins it).
- The build config now imports app TypeScript, so Vite bundles it to load; `VITE_CONFIG_NATIVE_IGNORE_WARNING`
  in the build scripts (here and in the exported snapshot's) is Vite's own switch for that.
- **Checked as a phone** (author's ask): `scripts/obsidian-rig-mobile.mjs` puts the rig into Obsidian's mobile
  emulation at 412 and 360 px with touch and a coarse pointer, and the claims are measured boxes. Fixed: the
  property icon sat 1px from the card (Obsidian's phone stylesheet bleeds the content 12px past the card and the
  look clipped it; now the desktop's 11px), the light badge rode 4px high on the taller row, a wrapped footer's
  rows were 10px out of line, the cube's Done stranded left, a button's label wrapped inside itself, the settings
  links broke mid-URL. And a scoper bug: a look rule on a body class other than `.theme-*` (`.is-mobile`) nested
  under the look class and never matched in the plugin; the rig's snippet had masked it. Real devices remain
  unchecked (spec § Out of scope). The author looked at the captures and caught the icon inset I had passed.
  Footer buttons on a phone go SMALLER under the coarse pointer (11px text at 412, 10px under 380), measured
  until the row/column buttons and Cancel/Save share one row; the author saw both tiers and ruled them fine.
- **An accent picker too** (author's ask): the settings swatch grid is now the toolbar's picker, not a legend, and
  the accent (a slot id, the gray swatch cycling the neutrals) persists in `data.json`. The chips' sheet takes
  it, and the look wears it as a third body class: `lookTokens.ts` splits each palette's tokens into the
  palette's block and one block per accent (its color, ink, HSL, and for Orchard and Blueprint the chrome ramp,
  which follows the accent's hue as in the app). So Blueprint under a blue accent is the authored cyanotype;
  under gold it is the sepia print the app shows at its default accent, which is what I had misread as a plugin
  divergence. Then the accent had to OWN the UI: the look had bound tabs, the top line, links, the active
  item, the h1 and the hr cable to the number hue (gold under Default), so `--sol-ink-accent` (the accent as
  text: itself on dark, the look's yellow rule on white) took those roles, graph nodes wear the accent (the
  active one the ink), and a type's hue means that type only. A light property badge's glyph is the ink that
  reads on its type color under the current palette (`--sol-ink-on-*`, the chips' contrast rule); dark icons
  keep the type hue (author's ruling after a wrong turn to all-ink icons).
- **Two cross-window bugs the rig caught once reproduced from a fresh start**: Obsidian's `toggleClass` tests
  `instanceof Array`, which an array from the main window fails in the settings window (its own window in
  1.13), so the look's classes toggle one at a time; and the graph view (a canvas) reads colors only on
  `css-change`, which a class swap never fired, so palette, accent and look changes trigger it.
- **The app reads the plugin's column picks** (the 1.4.2 backlog item): `pluginColumnTypes.ts`, read by Vault
  Folder beside `types.json` and by Import Obsidian Note with the note; a pick types that column above the
  guesser. The reader now keeps a row's ISO date as text until the column's type is known, so a Text pick
  holds and a mixed column no longer carries a bare serial. Desktop scope widened to that one path. The
  author's check in the desktop build found the imported frame's Source blank and no NaN: the importer typed
  cells before the app's boundary. Now every imported cell crosses `coerceFrameCell` with its text kept as
  the frame's `raw` (the existing FrameColumn field, Frame Input's own path), so a Number pick over a date
  column shows NaN over the text and the note keeps its text. Found beside it: a read-only popup grid ignored
  the Source toggle (`formatRenderActive` followed it only when editable).
- **A plugin editor's Save writes SOURCE TEXT, never a value through a type** (author 2026-09-22: a Number pick
  over a date column showed NaN and the Save wiped the dates). List, matrix and frame Saves keep an unchanged
  cell's scalar and write an edited one as YAML reads it (`parseCellText`, the cube's rule); a type switch keeps
  every cell's scalar; `validate` is shape-only inside a list or matrix (the family is a lens, not Obsidian's
  gate); the Complex field alone refuses what it cannot read. Verified in the rig by driving each editor's own
  Save and reading the note back: frame (the repro), numeric list, date list, matrix, cube, complex scalar. The
  rule is a node, [[D72]] pluginSaveWritesSourceText under C58 and C107 (author's ask; unratified).
- The column-format panel closed on any press inside it in the plugin: `useDismissOnOutside` read `e.target`,
  which a shadow root retargets to its host; now `composedPath()[0]`, the spec's rule. Verified in the rig.
- **The demo vault is BLOCK-STYLE YAML, what Obsidian writes.** Two reverts in one session had flipped
  Obsidian's rewrite of `Property types.md` back to flow style (author: "didn't we say multiple times to just
  do everything in the block style"); the repo copy is now block style (empty lists stay `[]`, `_types/` as
  authored). A block-style rewrite is never a stray edit; the `.obsidian/` config flips while the author tests
  live still are. The notes also lost their hard wraps: Obsidian renders a single newline as a break.
- Open (author 2026-09-22, not tracked further): the Linux desktop build pans a small graph less smoothly than
  Chromium on the same machine. Lead: WebKitGTK's compositing path; `WEBKIT_DISABLE_DMABUF_RENDERER=1` and
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` bisect it (`layout-chrome.md` § Desktop window frame has the zoom fixes).
