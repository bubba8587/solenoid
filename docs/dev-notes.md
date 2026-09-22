# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-22 — plugin 0.1.3: the look follows the palette; author present)

- **The Solenoid look wears the plugin's palette setting, not just the chips.** `look.css` authors no hex any
  more: `obsidian-plugin/src/lookTokens.ts` derives every color token from `palette.ts` exactly as the chips'
  sheet does (`themeVars`), the build appends one block per built-in palette and mode to `styles.css` under
  `body.solenoid-look.solenoid-palette-<name>`, and `main.tsx` swaps that class beside the look class (every
  window, settings included; `onunload` sheds both). Pure value swaps, author's word: the app already settled
  contrast, so the look's own ink/rule/wash formulas stand unchanged under every palette. The snippet stays
  the Default palette (rules + its two generated blocks; `look.test.ts` pins it). Manifest `0.1.3`, not yet
  published; the plugin repository's README still says "Default palette only" — fix it on export.
- The build config now imports app TypeScript, so Vite bundles it to load; `VITE_CONFIG_NATIVE_IGNORE_WARNING`
  in the build scripts (here and in the exported snapshot's) is Vite's own switch for that.
- Blueprint under the look: its chrome ramp is adaptive and the plugin's accent is fixed gold, so its workbench
  comes out warm, as its chips already did (spec divergence table). A plugin accent setting would reopen it.

### SESSION DIGEST (2026-09-21c — plugin 0.1.2, the directory review's findings; author present)

tsc + vitest green; the plugin was checked in the rig (Obsidian 1.13.7: settings tab, a popped-out note, a
palette change under an open editor).
- **Plugin `0.1.2` is PUBLISHED** (2026-09-21, the author's go): built from `solenoid@b233cee2`, the three
  release files byte-identical to the build checked in the rig, attested (`refs/tags/0.1.2`). The directory
  rescans each release; its next report is the check on what is left.
- **Most of the review's warnings were one defect: the snapshot did not typecheck.** The review lints WITH
  types, and the ten shimmed modules (plus one type-only import) did not resolve there, so everything through
  them was `any`: about ninety "unsafe" findings and many "unnecessary assertion" ones. The export now follows
  type-only imports, the snapshot's tsconfig lays the shims over `src/graph` with `rootDirs`, the shims carry
  the app modules' signatures, and the snapshot's build runs `tsc --noEmit` first (the guard on a shim).
- **The plugin was writing to Obsidian's `<html>`**, against its own requirement 3: `appTheme.ts` subscribes
  `apply()` to the palette at module level, so a palette change wrote 63 variables, `data-theme`, a forced
  `color-scheme` and a `theme-color` meta. `themeVars()` moved to `themeVars.ts` (pure) and `appTheme` is
  shimmed; checked in the rig, nothing is written.
- Two more shims for the review's Errors: `clipboard` (no `execCommand` fallback in a secure context) and
  `mobileUa` (split out of `coarse.ts`; Obsidian's `Platform` answers). The settings tab serves 1.13's
  `getSettingDefinitions()` and keeps `display()` for older Obsidian.
- The review is reproducible: `eslint-plugin-obsidianmd`'s recommended config run in the exported snapshot
  matched its counts. What stands, and why, is `specs/obsidian-plugin.md` § Publishing.

### SESSION DIGEST (2026-09-21b — plugin release readiness, the vault look; author present)

On `develop`, NOT pushed (the author's call). tsc + vitest green.
- **Plugin `0.1.1` is PUBLISHED** (2026-09-21): the directory's review REQUIRES the listed repository to hold
  the source, and recommended attestations, no extra release files, no `localStorage` and a clipboard
  disclosure. The plugin repo now carries a snapshot (`npm run plugin:export -- "<clone>"`: 87 app files + the
  plugin folder, its own pinned `package.json` and lock) and builds from it; the three release files are
  attested and verify (`gh attestation verify`), byte-identical to the build here. Vite takes any 1.2.x
  rolldown and a patch bump minifies React differently, so the export pins it. The directory reviews RELEASES,
  so a fix to a finding needs a new version.
- **Plugin `0.1.0` is PUBLISHED** (2026-09-21, the author's go): `bubba8587/Solenoid-Properties` release `0.1.0`,
  built from `solenoid@635905d9`, with the author's README and screenshots. It is LISTED at
  community.obsidian.md/plugins/solenoid-properties (Health: Excellent, Review: Pending), and the 1.4.1 release
  notes link it. The plugin repo clone
  is `~/projects/solenoid properties`; the release steps moved from its README to the spec's § Publishing.
- **Plugin settings** end with one "Solenoid" row carrying the deploy and the repository as bare URLs; the Property
  types sentence is gone (spec § settings page).
- **The vault look** is `demo-vault/.obsidian/snippets/solenoid.css`, switched on by `appearance.json` (now a
  fixture), with `Planning board.canvas` to show it on. What stands: dark wears the hues as ink; LIGHT is neutral or
  the full accent, never a hue mixed toward the ink (dark yellow is brown: gold and lime text go neutral and their
  color moves to fills, rules and 18px property badges; other hues darken with `oklch(from …)`). Tabs are node
  headers, gold unless a base / canvas / media, and each pane's accent line takes its active tab's color. Callouts
  and canvas groups wear the group look, a rule is a diagonal cable between two sockets, folder dots run the palette
  in order, and nothing anywhere is a side stripe. It targets Obsidian 1.13 (`--callout-<type>`, `--bases-*`).
  Shipping it with the plugin is the next step and needs its spec rule first (`backlog.md`).
- **Obsidian DOM facts that cost time:** `data-property-type` sits on `.metadata-property-value`, so a row is typed
  with `:has()`; `.metadata-container` is shifted `translateX(-4px)`; the property icon hides a 4px zero-width
  `::before`; rows stack with the gap ABOVE and the divider right under the content; the tab title color and the
  inactive tab's padding only yield to Obsidian's own long selectors or its `--tab-text-color-*` variables;
  settings is a second window (a second CDP page).
- **1.4.1 SHIPPED 2026-09-21** (tag `v1.4.1` on `907b5813`, pushed by the agent on the author's word): the
  release carries the Windows exe, the Linux AppImage and the `.deb`. A NEW workflow file cannot be run by hand
  until it is on the default branch, so the first Linux CI build was the push to `main` itself.
- **CI builds Linux too:** `desktop-build.yml` (was `windows-portable.yml`)
  has a windows job, a linux job (ubuntu-22.04, AppImage + .deb) and a release job that needs both. The Linux
  bundles build locally and the AppImage starts and computes on a scratch profile; neither job has run in CI
  since, and Windows has not compiled since v1.4.0. Product copy says Windows and Linux; one `DownloadLink`
  (siteNav.tsx) names the visitor's platform. Remaining steps: `backlog.md` § Release planning.
- **Desktop looks more saturated than the dev server on this machine, and that is color management, not the
  app.** The monitor is a P3-gamut panel (LG UltraGear; EDID primaries red 0.686/0.309, green 0.264/0.669) and
  colord set an EDID profile on the X root (`xprop -root _ICC_PROFILE`). Chromium reads it and maps the app's
  sRGB hexes into the panel's gamut, so it shows true sRGB; WebKitGTK ignores it and sends the values raw, so the
  same hexes stretch to P3 and read hotter. `chromium --force-color-profile=srgb` makes Chromium match the
  desktop. Neither look is rare: sRGB panels and fully managed setups (an iPhone, Chromium with a profile) show
  the muted one; unmanaged or boosted paths (WebKitGTK, Windows with no display profile, an Android phone in its
  default Vivid / Adaptive mode, where the author also sees it) show the vivid one the palette was tuned on.
  Whether to author the palette in `display-p3` is a design call (`backlog.md` § Canvas chrome).
  On the dev machine the display's DEFAULT colord profile is now standard sRGB (`colormgr
  device-make-profile-default`; the EDID profile stays listed), so `_ICC_PROFILE` is sRGB and every managed app
  (Chrome, Obsidian) shows the vivid look the desktop build does. Undo: System Settings → Color, or make the
  EDID profile default again.
- **The plugin's follow-ups are closed** (author: nothing left in the backlog for it). A frame column keeps the
  type the user PICKED (`data.json` by property then column; first guess from the YAML value's own type, never
  its text: re-inferring made the selector a lie and a Save turned `"0012"` into 12). A popped-out note keeps its
  editor: the popup layer follows the chip's window and the build rewrites the components' free `document` /
  `window` to the layer's (`popupGlobals`). A Complex scalar type, the look behind a toggle from one source
  (`look.css`), and the rig as `npm run plugin:rig`. Two backlog lines were simply WRONG when checked in real
  Obsidian: Bases cells show the chip, and a cube level has no type selector to persist.
- **Solenoid reads the plugin's types back as the same socket.** The Note node already read lists, frames and
  cubes right (the author's hunch held); three things did not survive: a matrix (a text list of `"[1,2,3]"`), a
  complex list (text) and a frame's date column (numbers). The Note node's three hand maps became lattice
  lookups (`typeAtRank`). Left in the spec's § Gaps: a column type picked in the plugin is not read here.
- **Rig note:** `pkill -f` with a plain pattern matches its own shell and exits 144 before the next command; write
  the pattern as `[X]ephyr :7`. The rig scripts are still scratch-only (`backlog.md`, plugin follow-ups (5)).

### SESSION DIGEST (2026-09-21 — publishing the Solenoid Properties plugin; author away)

On `develop`, pushed. tsc + vitest green. The path is `specs/obsidian-plugin.md` § Publishing.
- **Obsidian's list points at a repository, never a branch or folder**, and reads `manifest.json` from the default
  branch's root, so the plugin publishes from `bubba8587/Solenoid-Properties` (release-only: manifest, versions,
  README, LICENSE, a workflow). Its `source.json` pins a commit here; the workflow builds that commit and attaches
  `main.js`, `manifest.json`, `styles.css` and `third-party-licenses.txt` to a release tagged with the bare version.
- **The bundle is the reviewed artifact.** `perfProbe` is now shimmed (it registered two globals and logged on
  import); the rest of the `console.log` strings left in `main.js` are chrono-node's debug branch. The plugin
  build emits `third-party-licenses.txt` beside its files, and `test.yml` runs `npm run plugin:build`.
- **Bundle hygiene since:** `nativeAccent` is shimmed (it carried the Tauri API into `main.js`), and `onload`
  always sets the palette from the vault's `data.json`, because the store also reads `localStorage` and Obsidian
  shares that across vaults. The release workflow's build-only run passes against the pin.
- **The manifest stands as written** (author 2026-09-21): `minAppVersion` `1.9.0`, Title Case type names,
  `isDesktopOnly` false.
- **Left for the author:** a README rewrite with screenshots in the plugin repo, then the go to publish release
  `0.1.0`, and the submission through community.obsidian.md (the `obsidian-releases` PR path is retired).

### SESSION DIGEST (2026-09-20b — Solenoid Properties, the Obsidian plugin; author present)

On `develop`, pushed. tsc + vitest green. The rule is [[C107]] obsidianPlugin and the mechanics, the type table and
every divergence from the app are `specs/obsidian-plugin.md`; this is what is in neither.
- **Build and try:** `npm run plugin:build` (or `plugin:dev` to watch) writes `main.js`, `styles.css` and
  `manifest.json` into `demo-vault/.obsidian/plugins/solenoid-properties/`; reload Obsidian after a build. The test
  note is `demo-vault/Solenoid/Property types.md`; its keys are typed in `.obsidian/types.json`.
- **Obsidian's property-widget API is undocumented.** Read from the 1.13.7 `app.js`: a widget is
  `{type, icon, name(), validate(value), render(el, value, ctx)}` in `app.metadataTypeManager.registeredTypeWidgets`,
  `ctx` is `{app, key, onChange, sourcePath, blur}`, and `render` returns an object with `focus()`. On a value
  `validate` refuses it warns and shows the inferred type (the one exception is the type-switch bullet below), it
  skips re-rendering a focused property (the chip keeps its own state for that), and it turns an empty list into
  null on save.
- **What Shadow DOM cost:** a click-outside handler must read `composedPath()[0]` (the target is the host), a portal
  aimed at `document.body` is redirected into the popup layer (`shims/reactDom.ts`, app code only: react-dom/client
  needs the real module), and `@font-face` has to live in the document, so the fonts ride `styles.css` as data URIs.
- **Cutting the bundle** (693 modules to about 190, `main.js` 450 KB): the shims, plus three app-side import fixes
  that stand on their own. `useHeaderHeightVar` and the Record layout helpers (`recordLayout.ts`) moved out of files
  that import every node class, and date formatting imports `nodes/dateSerial`, not `nodes/date`.
- **Found on the way:** the note reader dropped a cube row whose value is a table (it read the key as a text list);
  `readRow` now nests. A YAML boolean column infers as Number through `frameFromRecords`, so the plugin types a
  frame from the cell text instead.
- **Verify against REAL Obsidian, not a fake module.** The fake passed while the plugin was broken twice: the
  settings page is a separate window (its own document, so shared constructed stylesheets adopt nowhere), and a
  property row is built off-document and attached after `render` returns (so a "drop disconnected mounts" sweep
  unmounted every chip but the last). The rig: `Xephyr :7`, then `/opt/Obsidian/obsidian --no-sandbox
  --user-data-dir=<scratch> --remote-debugging-port=9333` with an `obsidian.json` naming a COPY of the vault;
  puppeteer `connect` reaches `window.app` (`plugins.disablePlugin/enablePlugin` to reload a build,
  `setting.openTabById`, `metadataTypeManager.setType`, a leaf's `view.metadataEditor.rendered`). The author's own
  Obsidian is untouched. Spec § Verifying against real Obsidian.
- **A type switch hands a widget the OLD value.** Property menu → a type over incompatible data → "Update" calls
  `renderProperty(entry, true, true)`, the chosen widget over a value its `validate` refused; `setType` alone never
  does. `coerceYaml` reshapes it for display and edit, and nothing is written until Save. Not verified: Bases.
- **"Refresh All Connections does nothing in the release build" was settings, not refresh.** The two desktop apps
  keep separate settings: the release app's origin is `tauri://localhost`, the debug app's `http://localhost:1420`
  (`~/.local/share/com.solenoid.app/localstorage/` holds one store each). A vault folder set in one is unset in the
  other, and an unset vault falls back to the demo vault ([[D62]] demoVaultResolution), which a BUILT app bakes in
  as a snapshot while the dev server reads it live from disk. The Vault Folder card now says "Demo vault" when that
  is what it reads.
- **Author rulings this session**, all recorded in the spec: `sm` chips; a popup wears its TYPE's socket color
  (no launching node to inherit from); a popup sizes to the note's pane, not the window; the list editor the app
  does not have is a fine workaround; the settings page is the app's palette row with the real `SwatchGrid` and no
  sample chips; a list or matrix wears its family's Obsidian icon. Open follow-ups: `backlog.md` § Obsidian.
