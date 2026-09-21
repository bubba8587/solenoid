# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

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

### SESSION DIGEST (2026-09-20 — the dev machine is Linux; author present, local dev)

On `develop`, pushed. tsc + vitest + `cargo check` are green on Linux as they stood.
- **No PowerShell left.** `release:desktop` is `scripts/release-build.mjs` (any platform): it sets the home-path remap
  and FAILS the build if the binary still carries the home path or username. `dev-restart.ps1` is deleted.
- **One browser resolver**, `scripts/browser.mjs` (`$CHROME`, else the platform's system browser): the 20 puppeteer
  scripts and the string editor's scraper import it; `debug-browser.mjs` knows the Linux profile dirs.
- **Two local desktop apps.** `npm run desktop:debug` is a plain `cargo build`, so it loads the dev server at :1420
  (`tauri build --debug` would embed `dist/`); `release:desktop` is self-contained. Debug builds set a bug-badged window
  icon (`scripts/debug-icon.mjs` writes `icons/debug/icon.rgba`, embedded raw so no PNG decoder ships).
  `npm run desktop:launchers` installs pinnable `.desktop` entries for both; the debug one runs through a
  `solenoid-debug` symlink because GTK takes WM_CLASS from the program name.
- **Linux draws its own window controls** (`WindowControls.tsx` in the menu bar, undecorated window). decorum on Linux
  keeps the native bar, can inject its controls twice and builds a dead minimize from GNOME's `button-layout`;
  Windows still uses decorum's overlay. Resize comes from eight edge / corner grips that call `startResizeDragging`.
- **Crisp zoom on WebKitGTK with GPU compositing ON.** One promoted element inside a node puts the whole scaled
  viewport on a 1x layer that gets stretched. Three promoters are off on Linux: async overflow scrolling and 2D canvas
  acceleration (`src-tauri/src/linux_webview.rs`), and CSS transitions inside the viewport (`desktopFrame.css`,
  keyed on `html[data-webview="webkitgtk"]`); the last one was also the hover squish and the far-zoom blackout.
  Spec, triggers to avoid and the debug env var: `layout-chrome.md` § Desktop window frame. Chromium was measured
  for the same effect: 14 layers at 34 and at 154 nodes, nothing to gain there.
- **The fs scope names `.obsidian` literally**: on Unix a `**` never matches a dot-directory, so `.obsidian/*.json`
  reads and the `types.json` write failed silently (`capabilities/default.json`; note in `architecture.md`).
- **Testing rig that leaves the author's session alone:** `Xephyr :7` + `metacity`, the debug binary or WebKit's
  `MiniBrowser` on that display, python-xlib XTest for input, `xwd` for captures. It renders in software, so GPU-only
  artifacts (the blackout) do not reproduce there. The author accepted the zoom result "for now"; a blackout with the
  pointer over EMPTY canvas would point at GPU tile painting (`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` is the experiment).
- `git config core.ignorecase` was `true` from Windows; now `false`. No bare `python` here: `python3 tools/dte.py`.
- Not done, the author's call: product copy still says desktop is Windows-only (README, landing pages), and CI
  publishes only the Windows exe. `release:desktop` here also emits a .deb, .rpm and AppImage.

### SESSION DIGEST (2026-09-19 — frame popup column header; author present, local dev)

On `develop`, pushed (the author verified over HMR through the session).
- **The frame popup's column header is one row**: type button, name, paintbrush + chevron, sort. The per-column FC
  row is gone; its picks open from the paintbrush in a panel portalled above the popup layer. On a Frame Input the
  type cycle ends on **Fx**, which grows the formula row. Spec: `specs/literal-input-editors.md`.
- **A Frame Input λ input is named in the column formula**: `λ1` alone binds by name, `λ1(@a, @b)` calls it; the
  names list under the focused field. `FrameSourceColumn.lambda` is deleted (the column carries `expr` alone), the
  tokenizer and highlighter accept `λ` in a name, `calledNames` (excelFormula.ts) feeds the socket lookup.
- **A computed column keeps a date a date** (author: the same idea as unit passthrough). `exprYieldsDate` (excelFormula.ts)
  reads the functions' declared `returns` and the [[D41]] carry ops; both surfaces type through `computedColumnType`
  (nodes/frame.ts), so `@start + 7` and `TODAY() + 7` are Date columns with no type pick. Computed Column's `addAs`
  stays for what the formula can't show. Typed cells still refuse relative phrases ([[D54]] relativeDatesOptIn).
- **Only the sort button sorts** (author): the header cell is no longer a click target in the table or cube popups;
  `SortButton` (columnSort.tsx) is drawn on every sortable column and `stopSortTrigger` is deleted.
- **Editing a Date / Boolean cell** shows the calendar / checkbox on the right edge of the ONE cell being edited
  (`CellEditAffix.tsx`; the press keeps the text input focused). **The Form view edits in both modes** (it was a
  read-only Record figure with Source off) and its Date field is a text draft + calendar: the native date input,
  controlled per keystroke, wiped a half-typed year. `CalendarIcon` is shared with the Date Input node.- **Computed columns are marked in the Form and CSV views** (spec: `specs/error-values.md`): a label dot in the Form;
  in CSV a highlight mirror behind the textarea (`CsvEditor.tsx`, `csvFieldSpans` in csv.ts), typed-over values restored
  on blur, and ragged text refused with an error line while the table has a computed column.- **The CSV view** shows the grid's formatted text with Source off (FC picks included), edits in both modes (source text
  while focused), and the one CSV writer quotes any field that needs it (a formatted number or date carries a comma).
- **Text-cell suggestions are in-app** (`CellSuggest.tsx`): the native `<datalist>` is gone from the table popup.
- `.dteignore` skips `src-tauri/gen` and `sample-data`: git-ignored local output had `coverage --check` red on a dev machine.
- Open follow-ups are in `backlog.md` § Frame popup. Dev-server gotcha met three times: two edits to one file landing
  milliseconds apart can leave Vite serving the FIRST (a symbol used before its import); `touch` the file to re-serve.
