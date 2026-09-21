# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-21b — plugin release readiness, the vault look; author present)

On `develop`, NOT pushed (the author's call). tsc + vitest green.
- **Release `0.1.0` waits on the author**: a README rewrite with screenshots in the plugin repo, then a push of
  `develop`, then repin `source.json` (still `1dd18714`), rerun the workflow's build-only check (it passed against
  that pin) and publish on their go. The plugin repo clone is `~/projects/solenoid properties`; its README commit
  naming community.obsidian.md is unpushed too.
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
- **1.4.1 is bumped on `develop`** and CI now builds Linux too: `desktop-build.yml` (was `windows-portable.yml`)
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
