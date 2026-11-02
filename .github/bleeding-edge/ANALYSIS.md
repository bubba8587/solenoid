# Bleeding edge analysis

Covers the 2026-11-01 report: `develop` @ `af2c5550b`, branch head `bleeding-edge` @ `85e58dd3e`. Written 2026-11-02.

## Bottom line

Yes, you could take these upgrades into `develop` today. All 17 checks pass, and the two majors that moved (`magic-string` 0.30 to 1.4, `three` 0.186 to 0.187) turn out to be harmless for the way Solenoid uses them. The patch and minor bumps (Tauri, React 19.3.1, vite, vitest, marked, katex, dompurify, puppeteer-core and so on) are free wins on the evidence I have. The one thing I couldn't do is read GitHub release notes for the small bumps: this session's GitHub API access was blocked, so for those I only know "tests pass", not "here is what the authors said".

## What breaks

Nothing. Every check is green (engine, site, typecheck, unit tests, CLI, Obsidian plugin, all five Rust crates, desktop shell).

Two things in the report that are not dependency problems but are worth a look:

- **The ported-finding check fails because of the CI machine, not your code.** `89aeb9627` (text-fit for the Dashboard half box) "doesn't port" only because `git commit` in the workflow had no author identity ("Author identity unknown", from `port.mjs:35` called at `port.mjs:148`). Fix: have the workflow run `git config user.name` / `user.email` before calling `port.mjs`, or set `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env vars in `bleeding-edge.yml`. Until then the "Findings: 0 of 1 port" line is a false negative. I could not test the real port here.
- **Two carried commits were dropped for conflicts** (`ead5bd681` Rust 2024 let-chains, conflicting in `crates/solenoid-core/src/nodes/list.rs`, `crates/solenoid-graph/src/boundary.rs`, `direct.rs` and the wasm stamp files; and `ea43a26dd`, which touches `port.mjs`). Both are on `bleeding-edge-prev` and need redoing by hand if you still want them.

## Breaking changes that don't fail a check (yet)

- **`magic-string` 0.30.21 to 1.4.5 (major).** What changed, from diffing the two published packages: 1.x is ESM only. The CommonJS and UMD builds (`magic-string.cjs.js`, `.umd.js`) are gone, and the package now exposes only `./dist/index.mjs`. It still depends on `@jridgewell/sourcemap-codec`. Solenoid uses it in one place, `obsidian-plugin/vite.config.ts:6` and `:76-96`, calling `new MagicString`, `.overwrite()`, `.prepend()`, `.toString()` and `.generateMap({ hires: true })`. All of those are still in the 1.4.5 type definitions (`overwrite` at line 172, `prepend` at 184, `hires` at 20). That file is ESM, so no `require()` is involved. Verdict: safe, and the Obsidian plugin build passing backs it up. Two side notes: vitest and rollup already pulled 1.4.5 transitively before, so this just makes the direct pin match; and `rollup-plugin-license` still asks for `^0.30`, so npm now carries two copies (0.30.21 nested under it). Harmless, it just goes away when that plugin updates. Also `scripts/export-plugin-source.mjs:67` copies the installed version into the exported plugin snapshot, so the plugin release will now ship `magic-string` 1.4.5 as a dev dependency.
- **`three` 0.186.1 to 0.187.0 (pre-1.0 "major").** Only `scripts/motion/player.js` (plus `scripts/motion/render.mjs`) uses it: the offline motion renderer, not the app. No check covers it, so a green report says nothing about it. I diffed the two packages' source. What I found: the public export `CubeUVReflectionMapping` is removed (Solenoid doesn't use it); render targets now free their textures on `dispose()` and reset `depthTexture` to null when depth is switched off; `WebGLRenderer` viewport and scissor now scale by pixel ratio only when drawing to the screen, not into a render target. The player sets `setPixelRatio(1)` (`player.js:23`), so that last one multiplies by 1 and changes nothing. `EffectComposer`, `TexturePass`, `UnrealBloomPass` and `OutputPass` are byte-identical between the two versions. `ColorManagement.enabled = false` (`player.js:14`) and `HalfFloatType` render targets (`player.js:117-130`) are untouched. Verdict: I expect no visible change, but I did not render a clip. If you care about the motion output, run one capture through `scripts/motion/render.mjs` before and after and compare.

## New features worth using

I couldn't read upstream release notes (GitHub blocked), so this is limited to what I saw in the package diffs and I'm skipping filler.

- **three 0.187:** `mipmapsAutoUpdate` is now a render target option. The motion player's two accumulation targets and the composer's target (`player.js:117-130`) never need mipmaps, so setting it false would save a little GPU work per frame. Minor, optional.
- **magic-string 1.x:** nothing the one plugin transform needs.
- Nothing else I can point to with a Solenoid file attached.

## Hold back

Nothing needs holding. The only candidate is `three` if the motion renderer matters to you and you don't want to compare a clip yourself; it is a one-line revert in `package.json`.

## Security

- `npm audit`: none. `cargo audit` for solenoid-core, solenoid-graph, solenoid-parquet, solenoid-schedule and src-tauri: none.
- Transitive changes that touch the network or parsing: `ws` 8.22.0 to 8.22.1 and `rollup` 4.66.0 to 4.67.4. Both are patch releases and I couldn't read their notes, so I can't say whether either fixed a vulnerability. No advisory is flagged against the old versions.

## Since last week

There is no earlier ANALYSIS.md, so this is the first one and there is nothing to compare against. For reference, the report counts 3 direct dependencies moved in the latest daily run (2 majors) and 35 transitive ones (mostly the rollup platform binaries). Another 21 npm direct dependencies are ahead of `develop`, all patch or minor except the two majors above.
