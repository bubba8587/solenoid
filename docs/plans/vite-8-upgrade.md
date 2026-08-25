# Plan: Vite 8 upgrade (with @vitejs/plugin-react 6)

Backlog line: "Dependency updates → `vite` 7.3.6 → 8.2.1 WITH `@vitejs/plugin-react` 4.7.0 → 6.0.5".
Registry as of 2026-08-25: `vite@8.2.2`, `@vitejs/plugin-react@6.1.0` (the pair is hard-coupled:
plugin-react 6 declares `vite: ^8.0.0` only).

**Read first:** `CLAUDE.md`, this file, `vite.config.ts`, `docs/rules.md` row `classNameIsType`.

## Why this is gated, in one paragraph

Vite 8 replaces Rollup with Rolldown and esbuild with Oxc. Two of our build outputs depend on
things that change silently, and NEITHER `tsc` nor `vitest` can see them:

1. **`constructor.name` is the persisted node type.** `src/graph/persistence.ts:140` writes
   `type: n.constructor.name`; the loader maps that name back to the class. `vite.config.ts`
   keeps names with `esbuild: { keepNames: true }`. Under Vite 8 that key is deprecated and
   `keepNames` exists nowhere in the Oxc option types. If minification mangles class names, a
   PRODUCTION build (Vercel + the desktop exe) writes saves whose `type` is `a`/`b`/…, which
   no build can reopen. Dev is unminified and tests never build, so nothing warns.
2. **`rollup-plugin-license` emits `dist/third-party-licenses.txt`**, the license file we
   ship (compliance). Its peer is `rollup ^1–^4`; Rolldown claims Rollup plugin compatibility,
   but a plugin that silently no-ops or emits a partial file is the bad outcome. A loud build
   error is fine.

## Steps

Every step: `npx tsc --noEmit` + `npx vitest run` green before commit; commit by pathspec.

1. **Baseline, on Vite 7 (before touching anything).** `npm run build`, then record:
   - `wc -l dist/third-party-licenses.txt` and `grep -c '^Name:' dist/third-party-licenses.txt`
     (or whatever the per-package header line is — read the file and pick a stable count).
   - Class names survive: `grep -l 'XMatchNode' dist/assets/*.js` and
     `grep -l 'ListIndexNode' dist/assets/*.js` both hit.
   - Save these numbers in the commit message of step 2.
2. **Bump.** `npm i -D vite@8 @vitejs/plugin-react@6 --legacy-peer-deps` (the flag is a
   pre-existing elkjs/auto-arrange peer mismatch, not ours). Commit `package.json` +
   `package-lock.json` only.
3. **Fix `vite.config.ts` for keepNames.** Delete `esbuild: { keepNames: true }`. Set
   `build.minify` explicitly. Preferred order to try:
   - a. `build: { minify: "esbuild", ... }` + keep `esbuild: { keepNames: true }` — if Vite 8
     still honors the esbuild minifier as an optional peer, this is the smallest change.
     Check `npm ls esbuild` resolves (it's an optional peer now; install it as a devDependency
     if missing).
   - b. Otherwise `minify: "terser"`, `npm i -D terser`, and
     `terserOptions: { keep_classnames: true, keep_fnames: true }`.
   - c. Only if both fail: `minify: "oxc"` and look for an Oxc `keepNames`-equivalent in
     `node_modules/vite/dist/node/index.d.ts` (search `keepNames`, `keep_names`); do NOT ship
     with class names mangled.
   Also read the Vite 8 migration notes bundled in `node_modules/vite/` (CHANGELOG.md) for any
   other renamed option we use: `server.hmr`, `server.watch.ignored`, `clearScreen` — expect
   these to be unchanged.
4. **Trial build + the two artifact checks.** `npm run build`; then:
   - class names: the two `grep -l` checks from step 1 must still hit;
   - license file: present, non-empty, package count within a few of the step-1 baseline
     (the bundler swap may legitimately change tree-shaking by a package or two; a drop to
     zero or by half means the plugin didn't run — stop and report).
   If `rollup-plugin-license` throws under Rolldown, look for a Rolldown-native equivalent or
   Vite 8's own license emission; do NOT delete the license output to make the build pass.
5. **Runtime smoke on the built bundle.** `npx vite preview` (or serve `dist/`) and load the
   seed document; save it and inspect the JSON's `type` fields are class names (`NumberNode`,
   `XMatchNode`…), not single letters. Then reload that save. This is the real gate for (1).
6. **Desktop ride-along.** `npm run tauri build` once (or `release:desktop`) to confirm the
   Tauri bundler consumes the new `dist/` unchanged. Not a release; don't tag.
7. **Pin the gate.** Add a test that fails if the persisted type ever mangles: in
   `src/graph/catalogRegistry.test.ts` (which already asserts unique constructor names) add a
   check that every catalog class's `constructor.name` matches `/^[A-Z][A-Za-z0-9]+$/` AND
   is ≥ 4 characters. This runs unminified so it can't catch the build case directly, but a
   comment-free `scripts/check-dist-classnames.mjs` (greps `dist/assets/*.js` for two known
   class names, exits 1 otherwise) wired as `"postbuild"` in `package.json` CAN — add that
   script; it's the durable enforcement. Record the rule in `docs/rules.md` next to
   `classNameIsType` as ENFORCED by that script.
8. **Docs.** One digest line in `docs/dev-notes.md`; delete the backlog line; delete this file.

## Done when

- `vite@8` + `@vitejs/plugin-react@6` in `package.json`; `npm run build` green.
- `dist/third-party-licenses.txt` populated (count recorded vs baseline).
- `scripts/check-dist-classnames.mjs` exists and runs on `postbuild`.
- A production-build save round-trips with real class names (step 5 observed and stated).
- Full `npx vitest run` + `tsc` green; committed by pathspec; not pushed.

## Findings (append one line each; no fixes)

(none yet)
