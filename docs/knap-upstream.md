# Knap upstream: what to file

Ten things found while making `knap` (obsidianmd/knap, MIT) the Note/Report body syntax
(node-coverage § Annotation, dte:C68 knapIsTheDocumentSyntax). Five are bugs, five are
requests.

**Each entry is written to be filed as-is.** Everything down to the "Solenoid side" line is
meant for the issue or PR body; the "Solenoid side" line is our own note about what we do
in the meantime and should be cut before filing. Reword freely.

Verified against **0.6.0** on 2026-09-14, by running each repro and by reading the upstream
source at the 0.6.0 tag. `knapTemplate.test.ts` § "the Knap engine edges the help doc names"
pins the ones we tell the author about, so a future bump that fixes one fails our suite and
this file gets revisited.

**Nothing here is filed yet.** knap has one open issue (#10) and one open PR (#13), both
unrelated.

Every repro below uses the same data:

```
rows = [{Name:"Bob",Paid:40},{Name:"Ada",Paid:120},{Name:"Cy",Paid:10}]
```

## Bugs

### 1. Four collection filters were missed by the typed-value work in #14

**File this one first, and as a PR rather than an issue.** The fix is mechanical and the
pattern is already in the codebase.

**What happens.** PR #14 ("Preserve typed values through filter chains") moved the
collection filters onto a real `TemplateValue` return so a chain keeps its data instead of
turning into text. It got most of them. Four were missed and still declare `: string`:

| filter | file | what it does instead |
| --- | --- | --- |
| `slice` | `src/filters/slice.ts` | `JSON.stringify`, plus an explicit `slicedArray.length === 1` branch that returns `slicedArray[0].toString()` |
| `reverse` | `src/filters/reverse.ts` | `JSON.stringify` |
| `unique` | `src/filters/unique.ts` | `JSON.stringify` |
| `map`, arrow form only | `src/filters/map.ts`, `mapWithArrow` | `map:Name` was converted in #14, `map:x => x.Name` was not |

`sort`, `where`, `compact`, `first`, `last`, `nth`, `length`, `round` and `calc` all take
`inputValue` / `arrayInputValue` / `collectionInputValue` and return `TemplateValue`. The
four above need the same treatment, and `slice.ts` needs its singleton branch deleted.
`src/filters/first.ts` is eight lines and shows the shape.

**Why it matters.** The value silently stops being data partway down a chain, and where it
stops depends on which filter you happened to use. A template author has no way to predict
it and no error to go on: they get an empty result, or a stray `[`, or `[object Object]`.
`slice` is the worst of the four, because slicing down to exactly one item breaks a template
that worked fine on a longer list. That is a template that passes in testing and fails on
real data.

**Why this survived #14.** A `{% for %}` loop re-parses the JSON, so every loop-shaped test
passes. The gap only shows through `set`-then-index, and through a singleton `slice`.

**Repro.**

```
{% for r in rows | slice:0,1 %}{{ r.Name }}{% endfor %}
  → error: For loop iterable is not an array: string
  → the same line with slice:0,2 works

{{ rows | slice:0,1 | map:x => x.Name }}
  → [object Object]

{% set x = rows | reverse %}{{ x[0].Name }}
  → empty, and {{ x[0] }} gives "[", the first character of the JSON text
  → {% set x = rows | sort %}{{ x[0].Name }} gives "Ada", correctly

{% set x = rows | map:x => x.Name %}{{ x[0] }}
  → "[", where map:Name gives "Bob"
```

**Solenoid side:** seeds slice to three or more (`report-showcase`, `decision-matrix`) and
only index what `sort` or `where` produced.

### 2. A number passed to `date` is read as a date literal, so timestamps are impossible

**What happens.** `date` stringifies its input before parsing, so a number arrives as text
and gets read as a year.

**Why it matters.** Epoch milliseconds are the most common way a date crosses a boundary
between systems, and there is currently no way to format one. The failure is silent and the
output is plausible-looking nonsense, which is worse than an error: `1699` looks like a
year, so nothing about the result says "this is wrong."

**Repro.**

```
{{ 1700000000000 | date:"YYYY" }}  → 1699
{{ 46000 | date:"YYYY" }}          → 4599
```

This is the scalar half of #1. `date` should see the typed input.

**Solenoid side:** dates cross into the template as ISO text and never as numbers
(`toTemplateValue`).

### 3. Block tags always eat the following newline, and there is no way to control it

**What happens.** A block tag hardwires `trimRight: true`, so the newline after
`{% endfor %}` or `{% endif %}` is always removed. There is no way to turn that off, and no
way to trim the whitespace *before* a tag. The tokenizer already carries a `trimLeft` field
alongside `trimRight`, but nothing ever sets it to `true`, so half the plumbing is unused.
The obvious syntax for reaching it is a tokenizer error:

```
a{{- 1 -}}b               → Unexpected character '-' in template
a{%- if true -%}x{%- endif -%}b → same
```

**Why it matters.** The output is Markdown, where blank lines are semantic. A stray or
missing blank line around a loop changes whether two blocks are one paragraph or two,
whether a list stays a list, and whether two tables merge into one. Right now the author's
only lever is to restructure the template around the engine's fixed choice.

Two ways to close it, either is fine: add `{{-` / `-}}` and `{%-` / `-%}` and wire them to
the existing fields, or document that the trim is fixed so people stop expecting the Liquid
syntax to work.

**Solenoid side:** nothing needed. Our bare-tag rewrite only matches the plain form.

### 4. A filter cannot be used inside a condition, even in parentheses

**What happens.** `|` binds wrong against the comparison operators in the expression parser,
so a filter inside an `{% if %}` fails to parse. Parenthesizing it does not help.

```
{% if rows | length > 0 %}        → Missing %} to close {% if %}, Unexpected ">"
{% if (rows | length) > 0 %}      → Missing closing ), Unexpected ">"
{% set n = rows | length %}{% if n > 0 %}   → works
```

**Why it matters.** "Show this section only if the list has something in it" is close to the
most common thing anyone wants from a template, and the natural way to write it is rejected.
The workaround is fine once you know it, but nothing points you at it: the error message
talks about a missing `%}`, which sends you looking at your brackets rather than at the
filter. Parentheses being rejected too is the part that makes it feel broken rather than
merely limited.

**Solenoid side:** our mail-merge fixture (`tests/fixtures/mail-merge.json`) sets the value first.

### 5. A comma-joined `sort` parameter is read as one property name, and nothing warns

**What happens.** `sort:"Paid,desc"` is not read as a property plus a direction. It is read
as a lookup of a property literally named `Paid,desc`. No row has one, so every sort key is
undefined, the sort is stable, and the rows come back in exactly the order they went in.
`sort:"Paid,asc"` does the same. Only the pair form sorts.

```
rows in order: Bob(40), Ada(120), Cy(10)

{{ rows | sort:"Paid" }}            → Cy, Bob, Ada    (correct)
{{ rows | sort:("Paid","desc") }}   → Ada, Bob, Cy    (correct)
{{ rows | sort:"Paid,desc" }}       → Bob, Ada, Cy    (input order)
{{ rows | sort:"Paid,asc" }}        → Bob, Ada, Cy    (input order)
{{ rows | sort:"Nope" }}            → Bob, Ada, Cy    (input order, same thing)
```

The pair form does validate: `sort:("Paid","bogus")` errors with "invalid direction". The
comma form never reaches `validateParams` at all.

**Why it matters.** It fails silently and it fails *plausibly*. The rows come back, in an
order, and unless you happen to check against data where input order and sorted order differ
you will not notice. Worse, the comma form is what people will try first, because
`slice:0,3` and `nth:1,2,3` both take comma-separated parameters, so it reads as the house
style.

Two small asks here: let `validateParams` see the comma form so it can reject or accept it,
and warn when a sort key is present on none of the members (which would also have caught
this).

**Solenoid side:** seeds use the pair form, and `src/graph/help/knap.md` § Gotchas warns the
author.

## Requests

### 6. Export the variable collection that `validateVariables` already does internally

**What we need.** The root identifiers a template reads from its host, in first-use order,
with `for` iterators, `loop`, and `set` locals excluded.

**Why.** A host that builds UI around a template has to know what the template is asking
for. We turn each root name into an input, so the template's text is what defines the node's
shape. Anyone embedding knap in an editor, a form builder, or a settings panel needs the
same list.

**Why it should be easy.** `parser.ts` already computes this. `collectVariables` walks the
AST tracking defined variables and scoped references, and `validateVariables` uses it. It is
just not exported: `validateVariables(ast)` returns `ParserError[]`, so the names are thrown
away at the last step. Exporting `collectVariables` (or a thin wrapper returning names) would
cover it without new logic.

**Solenoid side:** `extractKnapVariables` in `knapTemplate.ts` is our own AST walk, which
would retire.

### 7. Mark keyword filter arguments in the metadata so hosts can tell them apart

**What happens.** In `{{ items | list:numbered }}`, `numbered` is parsed as a variable
lookup that falls back to the literal word only when the name is *undefined*. Supply it as
`null` and the fallback does not fire:

```
render("{{ items | list:numbered }}", { variables: { items, numbered: null } })
  → error: invalid list type null

render("{{ items | list:numbered }}", { variables: { items } })
  → renders the numbered list
```

**Why it matters.** The null-versus-undefined behavior itself is defensible, and is not what
we are asking about. The problem is that a host reading the AST cannot tell `list:numbered`
from `join:sep`. Both look like an identifier in an argument position. So the host either
mints an input for `numbered` and then feeds it a value, breaking the filter, or it skips
identifiers in argument positions and misses `join:sep`, which is a real variable. There is
no third option from the AST alone.

A `keywords` field on `FilterMetadata`, or the tokenizer marking such arguments as literals,
would settle it.

**Solenoid side:** an unwired input is absent rather than null, so the fallback still fires,
and our seeds quote the keyword (`list:"numbered"`).

### 8. Export `filterDocs` from the package, not just to the CLI

**What we need.** The filter documentation that already exists, available to library
consumers.

**Why this is nearly free.** `src/docs/filter-docs.ts` is already written and already good:
61 filters with a `summary`, `syntax`, `parameters`, `notes`, `examples`, `related` and
`searchTerms`, plus `filterGroups` with categories and intros, and `filterDocsByName` /
`filterDocsBySlug` / `allFilterSlugs` lookups. All of it is exported from that module and
consumed by `src/cli/help.ts`. None of it is re-exported from `src/index.ts`, so a library
consumer cannot reach any of it.

What the package does export is `standardFilterMetadata`, which carries only `example` and
`validateParams`, and 50 of the 80 filters have neither. So a UI built on the public API
shows a list of bare filter names, while the CLI right next to it has a full reference.

**Why it matters.** Anyone putting a filter picker, an autocomplete, or a cheat sheet in
front of a user needs this, and the alternative is every host writing its own copy of
documentation that upstream already maintains, and that then goes stale on every release.

**Solenoid side:** our Report overlay's filter list shows the example call and nothing else.

### 9. A synchronous render path

**What we need.** A `renderSync` that renders when every filter in the template is
synchronous, and throws if one returns a promise.

**Why.** Everything is async today because a filter *may* be async. That is the right
default, but it means a host pays the async cost on every render even when it is using
nothing but the standard filters, all of which are synchronous. In our case it pushed the
Report's evaluation onto the engine's async path, which then has to be plumbed through
everything upstream of it.

**Solenoid side:** we skip the render entirely when nothing is left for the engine after our
own bare-tag rewrite, which avoids the cost in the common case but not the plumbing.

### 10. A raw block, or some escape for a literal `{{`

**What we need.** A way to print `{{ x }}` as text.

**What exists.** Nothing. `{% raw %}` is "Unknown tag", and there is no backslash escape:
`\{{ x }}` prints a backslash and then interpolates. The only thing that works is splitting
the braces across a tag:

```
{{ "{" }}{ x }}
```

`{# … #}` is not a substitute, since a comment strips its contents rather than printing them.

**Why it matters.** Any note *about* templates needs this. Documentation for knap itself,
a note quoting an Obsidian Templates-plugin `{{date}}` token, a support answer showing
someone the syntax they got wrong. These are not exotic: the moment a tool is good enough
that people write about it, they need to quote it. And the workaround is unguessable and
unreadable, which means it will not survive anyone editing the note afterward.

**Solenoid side:** a Note holds bare tags naming no known field as literal text, which
covers the common case of a template note. A Report has no escape.

## Not bugs, do not file

Knap's own rules, working as intended:

- The newline after a block tag is eaten. That is Liquid behavior. See #3 for the part of
  this that *is* worth filing, which is the lack of control, not the default.
- An unknown variable renders empty.
- An object prints as JSON.
