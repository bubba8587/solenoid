# Knap upstream: what to file

Findings from integrating `knap` 0.4.0 (obsidianmd/knap, MIT) as the Note/Report body
syntax (node-coverage § Annotation, decisions knapIsTheDocumentSyntax). Each entry is
either a bug with a one-line repro or an API ask from the integration. Solenoid's
workarounds are noted so an upstream fix can retire them. Verified against the installed
package with `node` probes on 2026-09-10; re-verify before filing.

Repro data throughout: `rows = [{Name:"Ada",Paid:120},{Name:"Bob",Paid:40}]`.

## Bugs

### 1. Collection filters lose the typed value mid-chain (file this one first)
`sort` returns the array as a JSON **string**; `first`, `nth` and `slice` return the
stringified item (`[object Object]`); `set` stores the string form. `map`, `where`, `sum`,
`unique`, `join` and `list` keep the array, and `sort | slice | map` only works because
`map` re-parses the JSON.
- `{% for r in rows | slice:0,1 %}{{ r.Name }}{% endfor %}` → error "For loop iterable is not an array: string"
- `{{ rows | sort:"Paid" | first }}` → `[object Object]`
- `{% set top = rows | nth:1 %}{{ top.Name }}` → empty
Fix: every collection filter returns data shaped like `context.rawValue`, as `map` and
`where` do. **Our workaround:** seeds avoid `first`/`last`/`nth` after a sort and use
`slice` only ahead of `map`/`list`; `set` only for strings.

### 2. Numbers reach `date` as strings
`{{ 1700000000000 | date:"YYYY" }}` → `1699`; `{{ 46000 | date:"YYYY" }}` → `4599`. The
number is stringified and parsed as a date literal, so epoch milliseconds are impossible.
Same root as 1 on the scalar side. **Our workaround:** date serials cross into the template
as ISO text (`toTemplateValue`), never as numbers.

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

### 5. A bad `sort` parameter is silently ascending
`sort:"Paid,desc"` neither sorts descending nor warns; only `sort:("Paid","desc")` works.
`validateParams` on the metadata should reject (or accept) the comma form.

## API asks

### 6. Export a variable-collection helper
A host that mints inputs from a template needs the ROOT identifiers minus `for` iterators,
`loop` and `set` locals, in first-use order. `validateVariables(ast)` is almost it but
returns errors, not names. **Ours:** `extractKnapVariables` in `knapTemplate.ts`, an AST
walk that would retire.

### 7. Declare keyword parameters in filter metadata
`list:numbered` is a variable lookup that falls back to the literal word when the name is
undefined. A host cannot tell it from `join:sep`, so it mints a socket for `numbered`. A
`keywords` field on `FilterMetadata` (or the tokenizer marking such arguments as literals)
would let hosts skip them. **Ours:** an unwired input is ABSENT to the template, never
null, so the fallback still fires; seeds quote the keyword (`list:"numbered"`).

### 8. A `description` on `standardFilterMetadata`
The metadata carries `example` and `validateParams` only; the Report overlay's Filters
cheat-sheet can show the example call and nothing else.

### 9. A synchronous render path
Everything is async because a filter may be async; that forced the Report's `data()`
onto the engine's async path. A `renderSync` that throws when a filter returns a promise
would let hosts stay synchronous when all filters are. **Ours:** the render is skipped
entirely when nothing is left for the engine after the bare-tag rewrite.

## Not bugs (Knap's rules, kept)
The newline after a block tag is eaten (Liquid behavior; `seeds.test.ts` treats a tag line
as a block); an unknown variable renders empty (the Note's `keepUnknown` holds bare tags
literal on purpose); an object prints as JSON.
