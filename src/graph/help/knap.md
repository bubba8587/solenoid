# Knap

Knap is the template language for a **Report** and a **Note** body. Plain text is markdown, and a tag fills in a value: `{{ name }}` prints a value, `{% if %}` gates a section, `{% for %}` repeats one. It is Obsidian's own template syntax, so a Report round-trips to the vault as a normal note.

## The bare tag

A **Report** takes two inputs. The **Template** is the markdown, and each root name in a `{{ name }}` tag mints an input socket by that name. A wired **Note** can stand in as the template: its tags become the inputs, and its frontmatter fills the ones you leave unwired.

A bare `{{ name }}` embeds the wired value the way the canvas shows it: a formatted number, a table, a chart, a typeset formula, or a whole Note. Use the name any other way and it reads the plain data instead. `{{ total }}` embeds the formatted total; `{{ total | round }}` and `{% if total > 0 %}` read the number. `{{ table }}` embeds the grid; `{% for row in table %}` reads its rows.

## Blocks and filters

- `{% if x %}` … `{% elseif y %}` … `{% else %}` … `{% endif %}` gates a section.
- `{% for row in table %}` … `{% endfor %}` repeats over a frame's rows. Inside, `loop` holds the position and `row` is one row's `column: value` map.
- `{% set n = rows | length %}` names a value for later in the template.
- A filter shapes a value: `{{ paid | number_format:2 }}`, `{{ when | date:"D MMM YYYY" }}`, `{{ names | join:", " }}`. The Report overlay lists the available filters.

A name the template does not know renders empty. An object with no display form prints as JSON.

## Mail merge

Wire a frame or cube to **Records** and the Report becomes a mail merge: one page per row. Each page renders with `record` (that row's `column: value` map) and `index` (1-based) in scope beside the inputs. The **Page name** field names each page the same way, `{{ record.Name }}`; leave it blank to name pages by index. A merge writes one note per page. It draws the first 500 pages; a larger merge shows how many it kept, as "500 of N".

## Printing a literal tag

Knap has no raw block and no backslash escape. To print a literal `{{ x }}` (in a note that documents templates, say), write `{{ "{" }}{ x }}`.

## Gotchas

A few edges from the underlying engine:

- A filter cannot sit inside a condition. Set it first: `{% set n = rows | length %}{% if n > 0 %}`.
- After `sort`, read the list with `map`, `where`, or `list`. `first`, `nth`, and `slice` return text, not rows.
- For a descending sort, pass the parameters as a pair: `sort:("Paid", "desc")`. The comma form `sort:"Paid,desc"` sorts ascending.
- Quote a keyword filter argument: `list:"numbered"`, not `list:numbered`.
- Whitespace trimming (`{{- x -}}`) is not supported.
- A `date` filter reads text, so a date already crosses in as ISO text. A plain number passed to `date` does not work.
