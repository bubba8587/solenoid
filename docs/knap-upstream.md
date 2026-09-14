# Knap upstream: what to file

Findings from integrating `knap` (obsidianmd/knap, MIT) as the Note/Report body syntax
(node-coverage § Annotation, decisions knapIsTheDocumentSyntax). Each entry is either a
bug with a one-line repro or an API ask from the integration. Solenoid's workarounds are
noted so an upstream fix can retire them. Verified against **0.6.0** with `node` probes on
2026-09-14; re-verify before filing. `knapTemplate.test.ts` § "the Knap engine edges the
help doc names" pins the ones the author is told about, so a bump that fixes one fails.
Nothing below is filed upstream yet: obsidianmd/knap has one open issue (#10, unrelated) and
one open PR (#13, unrelated) as of this pass.

Repro data throughout: `rows = [{Name:"Bob",Paid:40},{Name:"Ada",Paid:120},{Name:"Cy",Paid:10}]`.

## Bugs

### 1. Four collection filters were left off the typed-value path (file this one first)
PR #14 ("Preserve typed values through filter chains", merged for 0.6.0) fixed most of what
was filed here: `first` and `last` keep the selected item's type (they returned
`[object Object]`) and `nth` returns a typed subset array, so
`{% set top = rows | sort:"Paid" | last %}{{ top.Name }}` works and the old "`set` only for
strings / no `first` after a sort" rule is retired. It did not reach every filter. In 0.6.0
these four still declare `: string` and hand the array on serialized:

| filter | src | what breaks |
| --- | --- | --- |
| `slice` | `src/filters/slice.ts` | a SINGLETON window returns `slicedArray[0].toString()` outright (explicit `length === 1` branch); otherwise `JSON.stringify` |
| `reverse` | `src/filters/reverse.ts` | `JSON.stringify` |
| `unique` | `src/filters/unique.ts` | `JSON.stringify` |
| `map` **arrow form only** | `src/filters/map.ts` `mapWithArrow` | `map:Name` went typed in #14; `map:x => x.Name` still returns a string |

`sort`, `where`, `compact`, `first`, `last`, `nth`, `length`, `round` and `calc` all take
`inputValue`/`arrayInputValue`/`collectionInputValue` and return `TemplateValue`. The fix is
to port these four the same way and delete slice.ts's singleton branch.

Repros, all of which a `{% for %}` over the same expression survives (the loop re-parses the
JSON), which is what makes this easy to miss:
- `{% for r in rows | slice:0,1 %}{{ r.Name }}{% endfor %}` → error "For loop iterable is
  not an array: string". `slice:0,2` over the same rows is fine.
- `{{ rows | slice:0,1 | map:x => x.Name }}` → `[object Object]`.
- `{% set x = rows | reverse %}{{ x[0].Name }}` → empty, and `{{ x[0] }}` → `[`, the first
  character of the JSON text. `{% set x = rows | sort %}{{ x[0].Name }}` → `Ada`, correctly.
- `{% set x = rows | map:x => x.Name %}{{ x[0] }}` → `[`, where `map:Name` gives `Bob`.

**Our workaround:** seeds slice to three or more (`report-showcase`, `decision-matrix`) and
index only what `sort` or `where` produced.

### 2. Numbers reach `date` as strings
`{{ 1700000000000 | date:"YYYY" }}` → `1699`; `{{ 46000 | date:"YYYY" }}` → `4599`. The
number is stringified and parsed as a date literal, so epoch milliseconds are impossible.
The scalar side of 1. **Our workaround:** date serials cross into the template as ISO text
(`toTemplateValue`), never as numbers.

### 3. Whitespace control is documented but rejected
The README lists whitespace control and every tag node carries `trimLeft`/`trimRight`,
but `{{- x -}}` is "Unexpected character '-' in template" from the tokenizer. Fix the
parser or the README. **Our workaround:** none needed; `embedBareVariables` only matches
the plain form.

### 4. A filter inside a comparison cannot be parsed, even in parentheses
`{% if rows | length > 0 %}` and `{% if (rows | length) > 0 %}` both fail ("Missing
closing )", "Unexpected '>'"). Only `{% set n = rows | length %}{% if n > 0 %}` works.
Precedence of `|` against the comparison operators in the expression parser. **Our
workaround:** the mail-merge seed `set`s the value first.

### 5. A comma-joined `sort` parameter is read as one property name, silently
`sort:"Paid,desc"` is not a property + direction: it looks up a key literally named
`Paid,desc`, finds it on no row, and returns the input order untouched — identical to
`sort:"Nope"`, and with no warning. `sort:"Paid,asc"` does the same. Only the pair form
`sort:("Paid","desc")` sorts, and only it validates (`("Paid","bogus")` errors). Two asks
in one: let `validateParams` see the comma form, and warn when a sort key is on no member.
**Our workaround:** seeds use the pair form; `src/graph/help/knap.md` § Gotchas warns the author.

## API asks

### 6. Export a variable-collection helper
A host that mints inputs from a template needs the ROOT identifiers minus `for` iterators,
`loop` and `set` locals, in first-use order. `validateVariables(ast)` is almost it but
returns errors, not names. **Ours:** `extractKnapVariables` in `knapTemplate.ts`, an AST
walk that would retire.

### 7. Declare keyword parameters in filter metadata
`list:numbered` is a variable lookup that falls back to the literal word only when the
name is UNDEFINED: `render("{{ items | list:numbered }}", { variables: { items, numbered: null } })`
→ error "invalid list type null", while leaving `numbered` out of the variables renders the
list. A host cannot tell that argument from `join:sep` in the AST, so it either mints an
input for `numbered` (and feeds it null) or misses a real variable. A `keywords` field on
`FilterMetadata` (or the tokenizer marking such arguments as literals) would let hosts skip
them. The null-vs-undefined split itself is defensible (null is a supplied value) and is
not the ask. **Ours:** an unwired input is ABSENT to the template, never null, so the
fallback still fires; seeds quote the keyword (`list:"numbered"`).

### 8. A `description` on `standardFilterMetadata`
The metadata carries `example` and `validateParams` only, and 50 of the 80 filters carry
neither; the Report overlay's Filters cheat-sheet can show the example call and nothing else.

### 9. A synchronous render path
Everything is async because a filter may be async; that forced the Report's `data()`
onto the engine's async path. A `renderSync` that throws when a filter returns a promise
would let hosts stay synchronous when all filters are. **Ours:** the render is skipped
entirely when nothing is left for the engine after the bare-tag rewrite.

### 10. A raw block, or an escape for a literal `{{`
There is no `{% raw %}` ("Unknown tag") and no backslash escape; the only way to print a
literal `{{ x }}` is `{{ "{" }}{ x }}`. Any prose ABOUT templates (a note documenting
Knap, an Obsidian Templates-plugin `{{date}}` a Report quotes) needs one. `{# … #}` is not
a substitute: it strips its contents rather than printing them. **Ours:** a Note holds bare
tags naming no field literal (`keepUnknown`), which covers the common case of a template
note; a Report has no escape.

## Not bugs (Knap's rules, kept)
The newline after a block tag is eaten (Liquid behavior; `seeds.test.ts` treats a tag line
as a block); an unknown variable renders empty (the Note's `keepUnknown` holds bare tags
literal on purpose); an object prints as JSON.
