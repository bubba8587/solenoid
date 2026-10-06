# fix(charts): name ariaLabel when it is missing or empty

## Summary

`ariaLabel` is required by the types, but an untyped caller that omits it gets `TypeError: Cannot read properties of undefined (reading 'replace')` from attribute escaping, and a mounted chart gets the label `"undefined"`. This validates it where markup is written and where a host mounts or updates, and throws `TypeError('A chart requires a non-empty ariaLabel string')`.

## Motivation

Found while moving Solenoid's charts from Recharts to TanStack Charts: our chart titles are user-authored and can be empty, so we checked what an unguarded label does. Nothing in the failure named the option.

## Changes

- `markup-internal.ts`: `requireAriaLabel`.
- Called from the SVG renderer, both Canvas shell prerender paths, and `mountChartRenderer` mount and `update` (an invalid update leaves the previous label).
- Tests in `svg-renderer.test.ts`, `canvas.test.ts`, `adapter.test.ts`; they fail before the change and pass after.
- Friction entry F-309; patch changeset.

## For the reviewer

- An empty string is now rejected too. That changes behaviour for typed callers passing `""`, which previously rendered an unnamed `role="img"`. If you'd rather only reject non-strings, it's a one-line change in `requireAriaLabel`.
- The check adds about 40 bytes gzip to static-SVG bundles, which crosses several locked budgets in `bundle:check`; the baseline needs a refresh if you take it.
- If several of our PRs land, the friction ids will need renumbering (each branch uses the next free id, F-309).

## Validation

- The three touched test files, `api-friction.test.ts`, and `pnpm typecheck`: pass.
- `pnpm test`: the only failures were the Solid and Svelte hydration tests timing out under parallel load (they pass run alone) and four `scripts/*.test.mjs` files that fail to load in our environment on unmodified `main` as well.
- `pnpm package:check` fails on unmodified `main` in our environment (React Native packed consumer, `react/jsx-runtime` named export), so it wasn't usable here.
