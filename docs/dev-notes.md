# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-10 — Knap replaces the `=name` syntax in Note and Report bodies)

- **Knap is THE document syntax** (knap.md, Obsidian's template language; the `knap` npm
  package, MIT, dayjs its one dependency; decisions knapIsTheDocumentSyntax). `{{ name }}`,
  `{% if %}`, `{% for %}`, `{% set %}` and the standard filters render at compute into the
  `document` output. Spec in `node-coverage.md` § Annotation; mechanics in `knapTemplate.ts`
  (AST walk for the root names, the bare-tag rewrite, value flattening, the engine wrapper).
  Pinned by `knapTemplate.test.ts`, `knapEngine.test.ts` (the real DataflowEngine awaits the
  async render through both Canvas wrappers), the Report/Note node suites and the seed tests.
- **The rule:** a Report's root template variables mint `trueany` inputs (one per name,
  first-use order). A BARE `{{ name }}` embeds the wired value as the canvas shows it (FC
  scalar, grid, chart, KaTeX, Note block) and `{{ name | highlight }}` is the tinted text
  form: both rewrite to the internal `` `=name` `` / `` `=name!` `` span before the render, so
  `inlineRefDisplay.tsx`, `obsidianMarkdown.ts` and `reportExport.ts` are unchanged. Any
  other use reads the data form: frames/cubes as rows, a document as its body, a date serial
  as ISO only when the SOURCE socket type says date, a chart as null. A Note's variables are
  its own frontmatter (no inputs). `data()` is async only when a tag is left for the engine.
- **Swept:** the five seeds with Report refs (`=x` → `{{ x }}`, `=x!` → `{{ x | highlight }}`),
  the Report overlay's Embed-a-Note token, the export (renders the template first), landing
  and catalog copy, decisionSeed/reportShowcase tests. `noteInlineRefs.ts` stays as the
  internal grammar (the machine-checked twin of `obsidianMarkdown.ts`'s regex).
- **Preview:** `useKnapRender` renders the live draft against the node's last variables on
  the Note card, the Import Obsidian card and the Report overlay; a syntax error replaces the
  preview with `line:column message` lines and lands as `#SYNTAX!` on the document. Knap eats
  the newline after a block tag, and 0.4 rejects the `{{-` trim dashes its README lists.
- The Write to Obsidian NAME field's `{{date}}` / `{{daily}}` tokens are `nameTemplate.ts`, a
  separate mini-language for file names. Unrelated syntaxes.
- **Template + Records on the Report (09-10b):** a wired Note is the text (its raw `source` rides
  the document; tags naming no field stay literal on a Note so a template note reads as one),
  its variables the sockets (`sideVars` persisted, `data()` reconciles via `dropInputCables`),
  its frontmatter the defaults; Records is the MAIL MERGE (the author's keyword; "Rows" said
  nothing): a wired frame/cube renders one page per row (`record`, `index`, the `pageName`
  Knap names each), and Write to Obsidian writes one note per page. Spec in
  node-coverage § Annotation; `mail-merge.json` is the worked seed; the report seeds gained a
  loop (showcase, decision memo) and an `{% if %}` verdict (garden). Pinned by the Report and
  knapTemplate suites; `seeds.test.ts` treats a Knap tag line as a block, not prose.
- **The follow-ups landed the same day (09-10c):** the Report overlay highlights the source
  (`knapHighlight.ts`: Markdown structure + Knap keywords, filters, strings, variables), lists
  the filters with examples, and steps a merge page by page. Write File taking a document
  (a merge as one `.md` per page into a folder) was built in `ec715ed` and BACKED OUT the
  same day (author): it lands as part of the Write mega-merge (backlog), not as a bolt-on.
- **Seeds exercise Knap's shaping filters** (author 2026-09-10): `sort:("col","desc")`, `slice`,
  `where:("col", v)`, `map:x => x.col`, `unique`, `sum:"col"`, `list:"numbered"`, `join` — the
  showcase's top-three months and ledger sum, the decision memo's sliced podium, the mail
  merge's paid-most-first roll and who-still-owes line. The knap 0.4 bugs and API asks the
  probing surfaced, with repros and the workaround each would retire, are `knap-upstream.md`
  (the author files them; backlog line). The one host-side rule they forced: an unwired
  Report input is ABSENT to the template, never null, so a bare filter word
  (`list:numbered`) still falls through to Knap's literal.
- **Holes at close (2026-09-10, for tomorrow):** nothing below is verified in a browser —
  every check this session was tsc/vitest/build. (1) The Report overlay's highlighted
  backdrop vs the transparent textarea: glyph alignment, scroll sync, mobile `data-tab`
  stacking, the wired-template read-only pane, the page stepper, the Filters popover.
  (2) The Report card's two fixed rows (Template, Records) via `RefInputRow`: the value
  preview for a frame/document and the dot placement. (3) A wired template whose Note
  changes its tags: `reconcileInputs` drops cables through a microtask — works in the
  engine tests, unseen on the canvas. (4) Write to Obsidian batch: per-page chart assets and
  block/append modes per page, desktop only, no test. (5) `MAX_PAGES` (500) truncates
  silently. (6) A literal `{{` in prose is now template syntax: knap has no raw block, the
  only escape is `{{ "{" }}{ x }}` (upstream item 10). (7) The Note card previews against
  the fields of the LAST commit (one blur behind while typing YAML) — by design, may read
  as stale. (8) No in-app help page for the template syntax: the catalog descriptions and
  the Filters cheat-sheet are all a user gets. (9) `first`/`nth` after `sort` are broken
  upstream (knap-upstream 1), so seeds route around them; a user will hit it.
