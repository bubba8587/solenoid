# Packages

Separately publishable MIT packages that live in this repo (npm workspaces; the app resolves
them by alias in `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`, so no install step
changes). The extraction trigger is a second consumer. Plan: `docs/v2.0/25-gantt.md` § 7.

- `schedule-engine` — the scheduling engine (calendars, graph, critical-path passes, diagnostics).
- `gantt-layout` — pure geometry: payload + width → render frame; the standalone SVG serializer.
- `gantt-react` — the React 19 figure over the layout.

No GPL, EPL or commercial code enters these trees; each README records what was studied.
