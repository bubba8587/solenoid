---
aliases: ["Reports and Notes"]
tags: [spec, documents]
---
<!-- [[C68]] knapIsTheDocumentSyntax, [[B1]] obsidianBet, [[C101]] onePatchPath, [[C103]] untrustedContentSeams -->

# Spec: Reports, Notes and the Knap template layer

Serves [[C68]] knapIsTheDocumentSyntax, [[B1]] obsidianBet, [[C101]] onePatchPath and [[C103]] untrustedContentSeams. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Two node classes hold markdown documents. A **Note** (`NoteNode`, `nodes/annotation.ts`) is a pure source: its frontmatter keys become typed output sockets and it mints no inputs. A **Report** (`ReportNode`, `nodes/report.ts`) is a pure sink for values: its template variables mint inputs, and it emits one rendered document. Both bodies are **Knap** templates. Knap is Obsidian's template language (the `knap` npm package, version 0.6.0), and `knapTemplate.ts` is the only module that calls it. Both nodes emit a **DocumentValue** on a `document` output, which Write to Obsidian, the Document chip and a Report's own inputs consume.

## The DocumentValue

`documentValue.ts` defines the value every document cable carries. `makeDocument` is the one place the `__document: true` brand is stamped, and `isDocumentValue` checks the brand, never the structure, because a DocumentValue crosses React roots. Serializing it to markdown is the consumer's job, since each ref resolves by kind and a chart needs the DOM.

| Field | Meaning |
|---|---|
| `body` | The rendered markdown. Internal `` `=name` `` spans are still present; a consumer resolves them against `refs`. |
| `refs` | `name → value` for every span the body may contain. A Note's is always `{}`. |
| `frontmatter` | Optional YAML fields, serialized ahead of the body at write time. No producer sets it today: a Note's frontmatter travels inside `body` as text. |
| `sourceId` | The producing node's id, so the Document chip can open it. Runtime only: documents are recomputed, never persisted on cables. |
| `source` | The un-rendered Knap text. A Note sets it to its raw body so a Report can use the Note as its template. |
| `pages` | `[{ name, body }]`, one per record, present only on a mail merge. |
| `total` | The record count, present only when it exceeds `pages.length` (the merge hit the page cap). |

A batch document's `body` is its page bodies joined by `PAGE_SEPARATOR` (`"\n\n---\n\n"`), for a consumer that reads one document.

## What an author types

A body is markdown with Knap tags. `hasKnapSyntax` treats a body as templated when it contains `{{`, `{%` or `{#` anywhere; a body without any of the three never touches the engine, and its node's `data()` stays synchronous.

| Syntax | Meaning |
|---|---|
| `{{ expr }}` | Print a value. `expr` is an identifier, a dotted path (`record.Name`), a literal, a comparison or logic (`a > 1 and b`), or `??` (fallback when undefined), followed by any number of `\| filter` or `\| filter:arg` stages. There are no arithmetic operators; the `calc` filter does arithmetic. |
| `{% if c %}` … `{% elseif c %}` … `{% else %}` … `{% endif %}` | Conditional section. |
| `{% for x in list %}` … `{% endfor %}` | Repeat. Inside, `x` and `loop` are bound. |
| `{% set n = expr %}` | Bind a template-local name. |
| `{# … #}` | Comment, may span lines, removed from the output. |

The filter set is Knap's `standardFilters` (`date`, `table`, `join`, `number_format`, `sort`, `slice`, `where`, `map`, `unique`, `sum`, `list`, `wikilink`, `yaml_property`, `highlight`, `calc` and the rest). Whitespace trim markers (`{{-`, `-}}`) are a parse error in this Knap version. Knap renders an undefined name as empty.

Nobody types the `` `=name` `` span. It is internal (see [[#The bare tag and the internal span]]).

### Root variables

`extractKnapVariables(body)` returns the names a template reads from its host: the ordered, de-duplicated root names, sorted by the offset of their first use. The root of `author.name` is `author`. A name is not a root variable when the template binds it itself: a `for` iterator and `loop` are local inside that loop's body, and a `set` name is local everywhere once the template sets it (it is removed from the result even when used before the `set`). A body with a syntax error still yields the names from what parsed, so sockets do not vanish mid-edit.

## The bare tag and the internal span

In a Report, a **bare tag** is exactly `{{ name }}` (optional inner spaces) or `{{ name | highlight }}`, where `name` matches `[A-Za-z_][A-Za-z0-9_]*`. Before the render, `embedBareVariables(body, inputs)` rewrites every bare tag whose name is one of the Report's inputs to the internal span:

- `{{ name }}` becomes `` `=name` ``.
- `{{ name | highlight }}` becomes `` `=name!` ``. The `!` is display-only tinting and is not part of the name, so `=rate` and `=rate!` share one input.

The rewrite walks tags left to right. A `{# … #}` comment is passed through verbatim before anything else matches, so a commented-out block never affects scope. A `{% for x in … %}` pushes `x` onto a shadow stack and `{% endfor %}` pops it; a `{% set n = … %}` adds `n` to a set of shadowed names from that point on. A bare tag is left for Knap when its name is shadowed or is not an input; a tag with any other filter, a path or an expression is never a bare tag. The input list is the Report's variable inputs, plus `template` when a template is wired and `records` when records are wired.

After the rewrite the body goes through Knap. Knap copies a backtick code span through untouched, so the spans survive the render. Each consumer then resolves them by kind: `inlineRefDisplay.tsx` on screen, `obsidianMarkdown.ts` at write, `reportExport.ts` at export. `noteInlineRefs.ts` holds the span grammar (`` /`=([A-Za-z_][A-Za-z0-9_]*)!?`/ ``) and `extractInlineRefs`, which lists span names in first-seen order. `obsidianMarkdown.ts` and `inlineRefDisplay.tsx` repeat the grammar locally; `obsidianMarkdown.test.ts` checks that the write copy agrees.

A bare tag embeds the value as the canvas shows it. Any other use of a name reads the value's **data form**.

### The data form

`toTemplateValue(value, sourceType)` turns a wired value into what Knap reads. `sourceType` is the data type of the source socket feeding the input, because a `trueany` input cannot tell a date serial from a number.

| Value | Data form |
|---|---|
| null or undefined | `null` |
| error value | its code text (`"#DIV/0!"`) |
| Frame | rows: an array of `{ column: value }`, date columns as ISO text, error cells as their code, missing cells as `null` (`frameToTemplateRows`) |
| Cube | rows, where a cell may be nested rows (a sub-cube or sub-frame), a list, or a unit cell's display magnitude (`cubeToTemplateRows`) |
| DocumentValue | its `body` text |
| Mermaid | a fenced `mermaid` code block |
| LAMBDA | `lambdaToMarkdown` (display math, see [[#Write to Obsidian]]) |
| unit cell | its magnitude in the display unit |
| array | each item converted; items become ISO dates when the source type is a date type |
| number | the number, or ISO text when the source type is a date type and the number is finite |
| text, logical | unchanged |
| chart, picture, SVG | `null` (they have no data form; a bare tag embeds them) |

A date serial becomes `YYYY-MM-DD` when whole and `YYYY-MM-DDTHH:mm:ss` when it has a time part. This is the form Knap's `date` filter parses; the Format Controller's display format does not apply here.

## Rendering

`renderKnap(body, variables, { keepUnknown })` never throws. It returns `{ output, errors }`; when any error exists the output is `""`. Each error carries a line and column, and `knapErrorText` formats them as one `line:column message` line each. A render error makes the node's `document` output a `#SYNTAX!` error value whose message is that text; the card and overlay previews show the same lines in place of the rendered body.

**keepUnknown** is the Note's mode. Before the render, every `{{ … }}` tag whose leading identifier is neither a known variable nor a template-local (any `for` iterator, `loop` or `set` name anywhere in the body) is replaced by an index sentinel, and restored verbatim after. Bare, dotted and filtered tags on an unknown name all survive as literal text, so a template Note reads as a template on the canvas and writes to the vault with its tags intact. The leading identifier is the first variable the tag reads, found by Knap's own parser, so an operator (`{{ not done }}` leads with `done`) or a literal keyword (`{{ true }}`) is never taken for one, and a tag that reads no variable (`{{ "{" }}`) is not parked. The template-locals are collected over the whole body, ignoring scope, so a Note that loops over a frontmatter list never parks its own iterator. An `if` or `for` on an unknown name still renders empty, as Knap does, because a block region cannot be parked without evaluating it. A Report renders without keepUnknown.

## Notes

### Fields and persistence

A Note persists `label`, `body`, `color` (a palette slot id, default `amber`), `width` (default 345), `height` (default 150), `collapsed` and `fieldTypes`. Everything else derives from `body`. `columnPicks` (per-frame-key column types recorded by the Solenoid Properties plugin) are read with an imported vault note and are not saved. `ImportObsidianNode` extends `NoteNode`, reusing all of the frontmatter machinery below and reserving an extra `path` output.

### Frontmatter becomes output sockets

`parseNoteFrontmatter(text)` in `noteFrontmatter.ts` is the pure parser.

- The block exists only when the first line trims to `---` and a later line trims to `---`. Without a closing fence there is no block and the whole text is the body.
- The render body is everything after the closing fence, with leading blank lines removed.
- The YAML between the fences is parsed with the `yaml` package (core schema, duplicate keys allowed). A key that repeats keeps its first occurrence. A parse failure yields no fields but still strips the block.
- Keys are trimmed; an empty key is skipped.

The field types are a subset of the socket data types with identical names, so the node maps a field to its socket by identity (`FIELD_SOCKETS` in `nodes/annotation.ts`). Each key's value is guessed into one:

| YAML value | Emitted value | Guessed type |
|---|---|---|
| number (plain) | the number (non-finite becomes null) | `number` |
| `true` / `false` | logical | `logical` |
| plain `YYYY-MM-DD` | rounded date serial | `date` |
| plain complex text with an imaginary part (`3+4i`, `-2i`) | the text | `complex` |
| any quoted scalar | the text, always | `string` |
| other text, null or empty | the text or null | `string` |
| sequence of scalars | a list. All present items dates gives `datelist`; any complex (numbers allowed beside them) gives `complexlist`; otherwise the first non-null item decides (`logicallist`, `list`, `strlist`); empty or all null gives `list` | list types |
| sequence whose every item is a sequence of scalars | a rectangular matrix (short rows padded with null), typed like a list of all its cells, lifted to rank 2 | `table`, `strtable`, `datetable`, `logicaltable`, `complextable` |
| sequence whose every item is a map of scalars, scalar lists or nested row lists | rows | `frame`, or `cube` when any row value is a list |
| a bare `{{ … }}` or `{% … %}` (YAML reads it as a flow map whose key is a map; the field is flagged `knapUnquoted`) | `#SYNTAX!` "Knap vars in frontmatter require quoted "{{var}}" syntax" on a `string` socket | `string` |
| any other map | null | `string` |

A non-scalar item inside an otherwise scalar sequence is kept as its YAML text. In a row, a plain ISO date stays as the text written; the column's type decides what it becomes.

A **frame** field builds a Frame (`rowsToFrame`). Columns are the row keys in first-appearance order, a missing key is a null cell, a list cell keeps its first scalar and a nested table cell becomes null. A column's type is the plugin's pick when present, else `date` when every present cell in that column read as an ISO date (`dateColumns`), else the first non-null cell's type (`logical`, `number`, `string`). Every cell passes through `coerceFrameCell` with its source text kept as `raw`, so a cell the type cannot read shows NaN over its text ([[D72]] pluginSaveWritesSourceText). A **cube** field is built by `recordsToCube`, which keeps a list value as a list cell. The row shape, `{ name: value }`, is the Script node's, so what one emits the other reads.

### Type pins

`fieldTypes[key]` is the user's pick, made from the glyph on the field row. A pin holds only the element family (number, text, date, logical, complex). On every sync the pin is reshaped onto the guessed rank (`typeAtRank`), so a scalar pin on a list value becomes the matching list type. A pin is dropped when either side is a frame or cube, and a pin for a key that no longer exists is pruned. Frame and cube rows show no picker. When a pin disagrees with the guess, `coerceScalar` converts each element: to number with `Number()` (logical gives 1 or 0, non-finite gives null); to text with `String()`; to logical as `true` for `1`, `"1"` or case-insensitive `"true"`; to date by parsing the text to a rounded serial.

### Reconcile

`syncFields()` reconciles the output sockets to the parsed fields and returns `{ removed, retyped }`. A vanished key's output is removed; a key whose socket type changed has its output removed and re-added under the same key; new keys are added. The `document` output (and a subclass's reserved outputs) is never touched. The node has no editor handle, so the caller cleans up cables: `dropStrandedFrontmatterCables` removes every cable from a removed key, and keeps a retyped key's cable only when `canConnect(newType, targetInputType)` still holds. After a retype the caller re-adapts downstream Format Controllers (`reconcileFcTypes`), because a pure retype fires no connection event.

The card reconciles on textarea blur and after a type pick, never per keystroke ([[C95]] commitOnEnter). A blur whose body equals the last reconciled body does nothing.

### Knap in a Note

A Note's variables are its own fields: `templateVariables()` maps each field value through `toTemplateValue` with the field's socket type, so date fields read as ISO text. `data()` returns the field values plus `document`:

- With no Knap syntax, the document is `makeDocument(body, {}, …, { source: body })`, synchronously.
- With Knap syntax, the whole body (frontmatter block included) renders with keepUnknown. On success the document body is the rendered text; on failure the document is `#SYNTAX!` and the field outputs still emit.

A **quoted Knap field** (`total: "{{ price | round }}"`) puts its rendered value on its socket. After a successful render, `renderedFields` re-parses the rendered frontmatter and reads each such field's text the way an unquoted scalar would read (`guessScalarText`: blank, `~` or `null` gives null; then `true`/`false`, numeric, ISO date as a serial, complex, else text). It stores the value and guessed type keyed by the raw tag text, and a later sync reuses that rendered value while the tag text is unchanged. When the rendered type differs from the socket's and no pin exists, the node re-runs `syncFields` in a microtask, drops stranded cables, re-renders itself and reconciles Format Controllers.

### The Note card

The card (`NoteNode.tsx`) shows a title bar (collapse chevron, editable title, color swatch), a strip of field rows, the `document` socket and the body. Each field row shows the type glyph, the key, a preview and the output socket; an attached Format Controller formats a numeric preview. Frames preview as `rows×cols Frame`, cubes as `rows×cols×depth Cube`, matrices as `rows×cols Table`, lists as their first four items, and dates in `DD-MMM-YYYY` ([[C44]] dateSerials). The field strip renders even when collapsed, so its sockets and cables survive. The resize floor is 160 by 80 px, plus 22 px per field row and 6 px of padding when any row exists. A resize writes no undo entry; it autosaves on release. When standoffs exist, the release settles them a frame later (the solver measures the painted size) with this note pinned, so its partner re-aligns to it, never the reverse.

The read view renders the Knap output (variables from the last committed sync, keepUnknown) with the frontmatter stripped. A Note renders no `` `=name` `` spans, since it has no inputs. When the Knap render left the body unchanged, the rendered GFM task checkboxes are enabled, and ticking the Nth one toggles the Nth task marker in the source (`toggleTaskMarker`), counting only markers below the frontmatter and outside code, so the index taken from the rendered body lines up with the source. A marker is the shape `marked` treats as a checkbox: a bullet item whose text opens with `[ ]` or `[x]` followed by a space or the line end. Code is a ```` ``` ```` or `~~~` fence, or a four-space block opened after a blank line outside a list; the frontmatter boundary is the parser's own. Any other click enters edit mode.

## Reports

### Fields and inputs

A Report persists `label`, `body` (default empty), `width` (200), `height` (96), `collapsed`, `sideVars` and `pageName`. It has three fixed sockets:

| Socket | Kind | Role |
|---|---|---|
| `template` (Template) | document input | A wired Note used as the template text. |
| `records` (Records) | cube input, uncoerced (`rawInputs`) | The mail-merge rows. A Frame arrives as a Frame, keeping typed date columns. |
| `document` (Document) | document output | The rendered report. |

Every other input is a **variable input**: one `trueany` input per root variable of the active source, in first-use order. The names `template` and `records` are never minted as variables, and `record` and `index` are not minted while records are wired.

`activeSource()` is the wired template's `source` (else its `body`) when a template is wired, and the Report's own `body` otherwise.

### Socket reconcile

`syncRefs()` runs when the overlay commits a body. Without a template, the wanted inputs are the root variables of `body`; with a template, they are the persisted `sideVars`. Before the first compute, every `sideVars` name is also kept, so cables restored at load find their sockets before the template's value is known. Departing variable inputs are removed and returned as `removedInputs`, and the overlay removes their cables.

During `data()`, when the active source's variables differ from the current ones, `reconcileInputs` updates the key list immediately and changes sockets in a microtask: it adds new inputs, drops the departing inputs' cables through `dropInputCables` before removing them ([[D10]] onePrunePath), then re-renders the card. `sideVars` is set to the active variables while a template is wired and cleared otherwise.

### Compute

`data(inputs)` does the following, in order:

1. Read `template` (kept only if it is a DocumentValue) and `records` (any non-null value).
2. Reconcile the variable inputs to the active source.
3. With a template wired, build a throwaway `NoteNode` from the source to read its frontmatter as **defaults**. A variable left unwired takes the template's field of the same name, and that field's socket type stands in for the missing source type.
4. Record each variable's value: the wired value, else the default, else null. The card rows and the on-screen spans read these (`refValue`), which also answers the fixed inputs: `refValue("template")` is the wired Note and `refValue("records")` the wired records (collected when lazy), each undefined while unwired. A variable counts as **present** only when wired or defaulted. An absent variable is left out of the template variables entirely rather than set to null, so a bare filter argument like `list:numbered` falls back to the word and `{{ x ?? "none" }}` works.
5. Build `refs` from the variables, adding `template` (the wired DocumentValue) and `records` (the wired value) when present.
6. Rewrite bare tags (`templateSource`). When records are unwired and no Knap syntax remains, return `makeDocument(src, refs)` synchronously.
7. Otherwise go async. If the template source has Knap syntax, render the throwaway Note first, so an unwired variable defaults to the field's rendered value rather than its tag text. Convert every present variable with `toTemplateValue` (a lazy frame reference is read in full first). With a template wired, the `template` variable is the raw source text.
8. With records wired, convert them to rows (a Frame or Cube becomes rows; anything that is not an array of plain objects contributes nothing), bind them as the `records` variable, and run the mail merge. Without records, render once.

A render or page-name error yields `#SYNTAX!` on `document`. `templateVars` (the data form of every input as of the last compute) and `pages` stay on the node for the overlay and the export. `renderedBody()` re-renders the current source against the last compute's variables for the webpage export; errors render as empty.

### Mail merge

`renderKnapPages(body, variables, records, nameTemplate)` renders one page per record:

- The first `MAX_PAGES` (500) records render; the rest are dropped, and `total` reports the true count.
- Each page renders the body with the host variables plus `record` (that row) and `index` (1-based).
- The page name is `nameTemplate` (the Report's `pageName`) rendered with the same variables and trimmed; a blank result names the page by its index.
- Names are unique ignoring case: a repeat becomes `Name (2)`, then `Name (3)`, and so on, so a batch never writes two pages into one note.
- The first page whose body or name fails to render stops the batch, and its errors become the document's `#SYNTAX!`.

The document carries `pages`, the joined body, and `total` when truncated. `batchTruncation(total)` returns `{ truncated, shown, total }` for the callers that say "500 of N": the overlay's stepper and Write to Obsidian.

### The Report card

The card (`ReportNode.tsx`) is an anchor, not an editor. It shows the Template row, the Records row, a divider, one row per variable input (label plus the ref preview described below, formatted by an attached Format Controller), a divider, and a hero box. The hero is the Document chip, which opens the overlay, or the error code when `document` is an error; clicking an error with an origin flies to the node that minted it. Collapsed, every input converges on one pill (`CollapsedInputPill`) so cables survive.

## On-screen rendering of the span

`InlineRefBody` renders a Report preview. It sets the sanitized HTML imperatively, finds every `<code>` element whose text matches `^=name!?$`, replaces it with an empty `<span>`, and portals an `InlineRefValue` into each. React never owns the parsed HTML, so re-renders do not orphan the portals. Each `InlineRefValue` subscribes to the cable-value store and re-renders only when its own `refValue(name)` changes.

The formatting annotation for a span is the Format Controller docked on that Report input, else one reachable upstream through passthroughs (`resolveRefAnnotation`). A Frame embed reads per-column formats from the node feeding the input, not from the Report.

| Value kind | Rendered as |
|---|---|
| number | `formatNumberWithAnnotation` when an annotation exists, else `formatScalar` |
| text | the annotation's text case, else as is |
| logical | the annotation's logical style |
| complex | complex formatting, with the annotation when there is one |
| unit cell | magnitude in the annotation's display unit, then formatted as a number |
| list | the first four items formatted, in brackets, with `…` when longer |
| null or missing | `—` |
| error | its code, error-styled, with the error tooltip |
| LAMBDA | KaTeX display math `f(p1,\,p2) = <body as LaTeX>` (`formulaToLatex`). It falls back to `λ(params) = expr` plain text while KaTeX loads or when the body does not convert. Parameter descriptions add a "where" legend. The annotation's `lambdaView` can pick `signature` (`λ(params)`), `mono` (plain text in monospace) or `syntax` (formula-highlighted) instead of the default `katex`. |
| chart | the chart figure at the container's width (at most 640 px, 320 when unmeasured) and 200 px high, with the annotation's font scale; KPI and scale cards render without waiting for a width |
| Mermaid | the diagram (`MermaidView`) |
| picture | an `<img>` at the value's height, or "no image attached" |
| SVG | the sanitized figure (`SvgFigure`) with the selected layer highlighted, or "no SVG loaded" |
| Frame | a grid (`FrameDisplay`), 25 rows by 12 columns and scrollable in the Report overlay |
| Cube | the compact cube display |
| DocumentValue | its body as markdown with the frontmatter stripped; its own spans substitute from its `refs` as preview text, and a name its `refs` lack stays a literal span |

In the Report overlay every figure kind (chart, Mermaid, picture, SVG, Frame, Cube, document) folds under a titled collapsible bar, open by default; the title is the value's title or the input name. The `!` flag tints only the inline text forms. A united value reaches a Report input with its unit tag stripped (a Report is not unit-aware; see [[unit-flow]]), so a unit shows only through a resolved annotation.

`refPreview` is the short text form that the card rows and the webpage export use: the inline text forms above, and for a figure the value's title, the selected layer (SVG) or the kind word (`chart`, `diagram`, `image`, `svg`, `frame`, `cube`, `document`).

## The markdown renderer

`renderNoteMarkdown` (`noteMarkdown.ts`) renders all Note-shaped text: Note cards, the overlay, a document embed and the webpage export. It is its own `marked` instance (GFM, single newlines as line breaks), so help prose and catalog descriptions (`Markdown.tsx`, `descriptionMd.ts`) are unaffected, and an error code in a description is never a tag. It returns unsanitized HTML, and every caller sanitizes. Before parsing, outside fenced code, it removes `%% comments %%` (a comment alone on its line takes the line with it) and trailing ` ^block-id` markers. Extensions:

| Form | Rendered as |
|---|---|
| `[[target#heading\|alias]]`, `![[…]]` | a `sol-md__wikilink` span (the embed variant for `!`); its text is the alias, else the target plus heading |
| `#tag` at a word start (the start of the text, or after whitespace or an opening bracket) | a `sol-md__tag` span. A tag is `#`, then letters, digits, `_`, `-` or `/`, not all digits, as Obsidian reads one; Vault Folder's `tags` column reads inline tags by the same rule (`TAG_BODY` in `vaultCube.ts`). An error code (`#NAME?`, `#DIV/0!`, `#N/A`) and an all-digit tag (a heading count) are not tags. |
| `==text==` | `<mark class="sol-md__hl">` |
| `$tex$` (no space just inside the dollars, no digit after) and `$$tex$$` | KaTeX once its chunk has loaded, else the source in a pending span; a KaTeX failure shows the TeX escaped |
| `> [!kind]± Title` | a callout. The kind picks an icon and, for failure, fail, missing, danger, error and bug, the danger ink. An unknown kind reads as `note`, and a blank title uses the capitalized kind. |

KaTeX loads lazily (`katexLoader.ts`): `useKatexRender` starts the load, `useKatexReady` only listens, and a site re-renders when the chunk lands. KaTeX renders HTML output only, with no MathML copy.

## The overlay

`ReportOverlay.tsx` is the editing surface. `reportStore` holds which node is open and whether the panel is docked. While one is open and docked, the root element carries `html.sol-report-docked` (see [[layout-chrome]]). Closing clears the dock. The Document chip opens whichever Report or Note produced a document.

Opened on a **Note**, the panel is read-only: the title, the dock and close buttons, and the note's raw body rendered with its frontmatter stripped. This panel does not run the Knap render.

Opened on a **Report**:

- **Source pane.** A transparent textarea over a highlighted backdrop (`knapHighlight.ts`: markdown structure plus Knap tokens inside every tag, every character preserved and escaped first). Typing writes `node.body` and schedules an autosave. Sockets reconcile on blur, on close (Escape, the close button, a backdrop click) and on switching to the Preview tab. With a template wired, the pane shows the template's highlighted source read-only, under "Template from the wired Note. Edit it there."
- **Preview pane.** Renders `templateSource(draft)` against the last compute's `templateVars`, 250 ms after the last keystroke. It renders from a debounced copy of the draft because re-parsing on every keystroke would remount the whole pane, jumping the scroll and remounting embeds. The previous render stays up while the next one settles. Errors replace the preview with their `line:column` lines.
- **Embed Note.** Lists every Note in the graph. Picking one inserts `{{ <name> }}` as its own paragraph at the caret (the Note's addressable name, minted if missing), mints the input, and wires the Note's `document` output to it.
- **Filters.** A searchable list of every standard filter with its example; a click inserts ` | <example>` at the caret.
- **Export.** The webpage export, when the site chrome allows it.
- **Dock.** Toggles a right-side docked panel (440 px, `--report-dock-w`) with no backdrop. Docked, a small Draft/Preview toggle replaces the side-by-side split; on mobile, a full-width tab bar does the same. The Dock button shows on desktop only, since on a narrow screen the report is already full-screen. Docked, the canvas area narrows by the dock width, and the viewport-fixed nav pill, HUD column, socket legend and command palette shift left with it.

**Layout.** On desktop the overlay sits under the app bar, which stays usable, and the panel fills the remaining height. At a viewport width of 760 px or less the side-by-side split becomes Draft and Preview tabs, decided by width alone, never by device detection. An image or SVG embed with nothing loaded shows a quiet inline hint ("no image attached", "no SVG loaded"), not an error. A Frame embed never scrolls vertically, so its chip stays in view; a wide one scrolls sideways.

Embed Note and Filters are disabled while a template is wired. With records wired, the preview shows one page at a time. A header row holds a stepper (`‹`, `name.md`, `i / N`, `›`), "first N of M" when the merge was capped, and the **Page name** field, which commits on blur or Enter and recomputes the graph.

## Write to Obsidian

Write to Obsidian's Note target takes a DocumentValue on `in` and writes markdown that Obsidian renders natively, never HTML. It acts only from its Run button and loads disarmed ([[C38]] sinkRunButtonOnly). Run refuses, with a status message, when the node is disarmed, the vault is the read-only demo vault, the app has no filesystem (web), no vault folder is set, the note has no name, the input is an error (the message is its code) or the input is not a document. The Properties target (rows to frontmatter) is a separate behavior of the same sink and is not covered here.

**Target.** The `path` input or literal names the note; a leading `folder/` prepends to the node's subfolder and a trailing `.md` is dropped. A blank name falls back to the node's label, then `note`. Path segments that are empty, `.` or `..` are dropped, so a write cannot leave the vault. File names pass through `sanitizeName` (the last path segment, with `<>:"|?*` and control characters removed). Preview reports the action it would take (Create, Overwrite, Append to, Rewrite the block in) with a character count.

**Pages.** A document with `pages` writes one note per page, named by the page; a page whose name sanitizes to nothing takes the target name numbered by its position (`Report-2`), so pages never overwrite each other. A merge with no rows (`pages` empty) writes nothing, and the status says so. A document without `pages` writes one note under the target name. The status reads `Wrote N notes` (or `N of total` when capped), plus any asset count.

**Markdown assembly.** For each page, `assembleDocumentMarkdown` resolves every distinct span name once through the resolver, replaces each span with the result, and prepends the frontmatter YAML when the document carries `frontmatter`. A `` `=name!` `` span whose result is one non-empty line becomes `==result==`; a block result is left unmarked, since an embed cannot sit in a mark. An empty result removes the span. The resolver is a callback, which keeps the DOM render and the file writes out of the pure module. It maps values as follows:

| Value | Written as |
|---|---|
| Frame | a GFM pipe table, cells formatted by column type (`formatFrameCell`), `\|` escaped and newlines turned into spaces; a frame with no columns writes nothing |
| Mermaid | a fenced `mermaid` block |
| LAMBDA | `$$` display math `f(params) = body` plus a "where" list (`- *param* — description`); a body that does not convert writes `` `λ(params) = expr` `` |
| DocumentValue | its body without its own frontmatter |
| picture | a web URL as `![alt](url)`; a `data:` URL written as an asset and embedded as `![[file]]` |
| chart | the source node's live SVG (or the SVG a provider supplies, such as the Gantt figure) rasterized to PNG at 2 to 4 times scale (targeting at least 640 px wide), written as an asset and embedded as `![[file]]`; nothing when the chart is not on the live canvas or is under 8 px. The vault has none of the app's CSS, so computed styles are baked into the SVG first. A live element is sized from its measured box, since a recharts root has no reliable intrinsic size until drawn; a provider's SVG from its root `width`/`height` (unit stripped), else its `viewBox`. This is why charts write only from the Run click. |
| null | nothing |
| anything else (a number, text, a logical, an error, a list, a unit value, a complex, a Cube) | the text the screen shows: `refPreview` with the source Report's format pick for that ref (`resolveRefAnnotation`) |

Assets are named `<note name>-<ref name>.<ext>` and go to the asset subfolder setting, else beside the note; the `![[file]]` embed resolves by file name anywhere in the vault. A chart's source node is found by following the cable into the producer's input of the same name.

**Modes.** `mergeNoteText(existing, md, mode, blockName)`:

- `overwrite`: the note becomes the markdown.
- `append`: the markdown is added after the existing text, with trailing whitespace trimmed and one blank line between.
- `block`: the writer owns the span between `%% solenoid:begin <label> %%` and `%% solenoid:end %%` (`managedBlock.ts`). An existing pair outside code fences has its span replaced; otherwise a new pair is appended after one blank line, and an orphan begin marker is left alone. An end marker closes the nearest begin marker of any name before it, so an orphan never pairs with a later block's end and a rewrite never swallows the text between them. Content carrying `%%` outside a fence is refused, since Obsidian would hide it.

A note that does not exist yet is written as the markdown (wrapped in markers for `block`). In `block` mode the writer's addressable name keys the pair, so two writers own two blocks; the markers are Obsidian comments, hidden in reading view. An unclosed code fence runs to the end of the note.

**Frontmatter YAML** (`frontmatterToYaml` in `obsidianMarkdown.ts`; `yamlScalar` is shared with `frontmatterPatch.ts`). The block is `---`-fenced with a trailing newline, keys in insertion order, and empty when there are no keys. A list is a block sequence (`key: []` when empty). A scalar is written bare unless YAML would misread it:

- null is empty, a finite number is bare, a non-finite number is quoted, and a logical is `true` or `false`;
- text is quoted when it is empty, has surrounding whitespace, contains any of `:#[]{}",` or a newline or tab, reads as `true`, `false`, `null`, `yes`, `no`, `on` or `off` in any case, starts like a YAML number (an optional sign, then a digit or a dot and a digit: `+1`, `-.5`), starts with a YAML indicator (`*&!|>%@'` or a backtick, or `~`), is a bare or space-followed `-` or `?`, or is an infinity or NaN word (`.inf`, `-.inf`, `.nan`, any case); a test reads every such value back through the `yaml` package;
- quoted text is a double-quoted scalar with backslash, quote, newline, carriage return and tab escaped, so a multi-line value stays valid on one line.

A key is quoted when it is empty, contains any of `:#[]{}",'|>%@` or a backtick, starts with `-`, `?`, `!`, `&`, `*` or whitespace, or ends with whitespace.

**Stamp.** When `stamp` is on and exactly one note was written, the note's frontmatter gains a `solenoid:` link to a `Solenoid/<doc>` stub note through `patchFrontmatter` ([[C101]] onePatchPath), and the stub note is merged. Stamping never fails the write. This is the only frontmatter write on the document path; a Note's own frontmatter reaches the vault as the text of its body.

## Webpage export

The overlay's Export button writes one self-contained `.html` file (`reportExport.ts`), through the native save dialog on desktop or a download on web. There is no PDF export, and no markdown export from the overlay; the vault write is the markdown path.

1. Load KaTeX first when the Report's body contains `$`.
2. Capture a canvas snapshot image (`captureCanvasImage`).
3. Take `renderedBody()` (a mail merge joins its pages with the page rule).
4. **Freeze** every `` `=name` `` span whose name is a variable input, `template` or `records`. A span whose value is unknown (an unwired fixed input) or a document is left as a span. A Frame becomes its grid as a pipe table, a block of its own (`frameToMarkdownTable`). Any other value becomes its `refPreview` text with the resolved annotation, markdown-escaped (`\`, `` ` ``, `*`, `_`, `[`, `]`), and a highlighted span (`=name!`) wraps it in `==…==`. A chart freezes to its title; its figure appears in the export's Charts section.
5. Split the frozen body at each remaining span whose value is a document, and render each segment separately. Each embedded document renders as a `report-export__embed` block headed by the escaped input name, with its frontmatter stripped.
6. Append a **Charts** section with the serialized SVG of every chart on a node wired directly into the Report or into a Note wired into it, each labeled with its node's display name, then a **Canvas snapshot** section with the image.
7. Title the page with the escaped label (default "Report") and an "Exported from Solenoid" timestamp. The stylesheet is inline and dark. The accent (the `sky` slot) tints the title and section rules only when the document declares a report palette; wikilinks, highlights, callouts and tags always take the accent.

The file name is the label with every character other than word characters, spaces and hyphens removed, plus `.html`. A failure raises an error notice.

## What is sanitized, and where

A body arrives in shared `.solenoid` files, so no rendered body is trusted. Each guard sits at one seam ([[C103]] untrustedContentSeams).

| Surface | Guard |
|---|---|
| Note card read view | `DOMPurify.sanitize` on every render. Checkboxes are re-enabled after sanitizing, on marked's own `<input>` elements only. |
| Report preview, Note panel, embedded document | `DOMPurify.sanitize` on the rendered HTML. |
| Webpage export | each markdown segment passes DOMPurify; the title, embed names and chart labels pass `escapeHtml`; frozen values pass `escapeMd` before re-parsing. Chart SVG is serialized from the live canvas. |
| Source highlight | the source is HTML-escaped before any span is added. |
| Links in rendered markdown | one capture-phase document click guard (`installExternalLinkGuard`, installed by `App.tsx`) opens `http(s)` links to another origin, and `mailto:` links, in the system browser (a new tab on web), and never navigates the app's webview. Same-origin, hash and relative links are left alone. |
| SVG | markup is sanitized once at intake by the SVG Picker (`svgSanitize.ts`), because the picker inlines it into the live DOM (hit-testing needs real elements) and it persists in the document. A text pass, which works headless and is what the tests pin, removes scripting elements, `on*` handlers (quoted or bare), every external `href` or `xlink:href` (a `use` or `image` beacon, an anchor) while keeping a local `#fragment`, and `javascript:` or `data:text/html` in any value; ids, names, classes, paths and fills stay. DOMPurify's SVG profile then runs wherever a DOM exists. An SVG embedded in a Report is already clean. |
| KaTeX and the lambda syntax view | KaTeX output and `highlightFormula` output are the only unsanitized HTML inserted, both generated from the value rather than copied from it. |
| Vault write | markdown only; `..` segments dropped; file names sanitized; a managed block refuses `%%` content; frame cells escape pipes and newlines. |
