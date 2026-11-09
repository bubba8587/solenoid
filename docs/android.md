# Android app: preparation and the local agent's plan

<!-- [[B2]] webTryDesktopFull: the Android app is the full app in a phone's shell. -->

**Status (2026-11-04):** prepared in a cloud session; **the shell compiles for Android** (the cloud build below,
JDK 17, NDK 30.0.16248370: a universal debug APK of about 100 MB, most of it debug symbols), and **runs on the author's phone** with granted
folders (run #4, 2026-11-04; the author's first pass found it working well; Phase 4's list not yet walked in full). Everything that doesn't need the Android toolchain is
in the repository; a local agent on the author's Linux machine does the build, following § Plan below. The app is the
desktop app, packaged: Tauri 2 builds Android from the same `src-tauri`, so the cards behave as on desktop and the
screen is the phone layout the web app already has. Only what a phone lacks (a window frame, a file manager) or does
differently (pickers, storage permission) is handled.

## What is in place

| Piece | Where |
|---|---|
| The window frame, Linux shims and debug icon run on desktop only; `tauri-plugin-decorum` is a desktop-only dependency | `src-tauri/src/lib.rs` (`desktop_window`), `src-tauri/Cargo.toml` |
| `open_devtools` and `toggle_fullscreen` do nothing on a phone (the webview is inspected from a computer's `chrome://inspect`) | `src-tauri/src/lib.rs` |
| Permissions: the desktop file is `platforms: linux, macOS, windows`; Android has its own, the network and links with no file scope (its files go through the folder plugin) and no window permissions | `src-tauri/capabilities/default.json`, `android.json` |
| **Folders on Android** (author 2026-11-04): see § Folders on Android | `src-tauri/android/SafPlugin.kt`, `src-tauri/src/saf.rs`, `src/graph/androidFolders.ts` |
| `isAndroidApp()`: the Tauri shell on Android. `isDesktop()` stays true there, since it means "has the desktop's files and network" | `src/graph/fileBridge.ts` |
| `html[data-shell="android"]`, so the desktop frame's CSS stays off; no F11, F12 or window border calls; no "Open documents folder" | `src/main.tsx`, `fullscreen.ts`, `devtoolsHotkey.ts`, `nativeAccent.ts`, `menuModel.ts` |
| A folder (Settings' vault, data and documents folders) is granted in Android's own folder picker; a card's file inside one is picked in the app's own picker, which lists the granted folder | `pickFolderDialog` in `fileBridge.ts`, `chooseFile.ts` |
| Opening a file in another app (File Link) says it isn't available: the opener hands Android a `file://` address, which Android refuses | `openFilePath` in `fileBridge.ts` |
| Opening and saving files (a document, a CSV or web-page export, a Write File sink, a File Link pick) use the app's picker inside the documents folder (author 2026-11-04), granted the first time it's needed: Open lists files, Save As browses folders and takes a name in the footer (the picker's `save` mode), and an existing file asks before it is replaced. A picker that can't list its folder (a revoked grant) says so in place of the list | `androidDocsFolder`, `androidSaveAs`, `androidOpenFile`, `treeProblem` in `fileBridge.ts`; `FilePicker.tsx` (`save`, `withExtension`) |
| The back gesture closes the topmost popup, menu or panel, as Escape does, and leaves the app (saving first) only from the bare canvas (author 2026-11-04). "Open" is a surface on the shared Escape hook, a menu on a popup, or anything with a dialog, menu or listbox role | `androidBack.ts`; `core:app:allow-exit` in `android.json` |
| Leaving the app saves (Android can end a backgrounded app without a `pagehide`) | `persistence.ts` |
| Settings, Data says Solenoid sees only the folders chosen there; a granted folder shows by its name on the phone | `Settings.tsx` (`AndroidFilesRow`, `folderLabel`) |
| The project patch: copies the folder plugin into the app's package, allows plain http in release too, asks for no storage permission; idempotent, run by the npm scripts | `scripts/android-prep.mjs`, `tests/graph/androidPrep.test.ts` |
| A debug APK built on GitHub's runners (their Android SDK and NDK) on each push touching the shell: checks the Android compile with no local toolchain | `.github/workflows/android-build.yml` |
| Edge-to-edge checked in Chromium 153 with a 40 px status bar and a 28 px gesture bar faked through `env(safe-area-inset-*)` (2026-11-04): the top bar, the bottom toolbar, the menu sheet, Settings, a table popup and the notices all clear them. Rerun with `node scripts/shot-graph.mjs <graph> --size 390x844 --insets 40,28` | `scripts/shot-graph.mjs` `--insets` |

## Folders on Android

Android gives an app the folders the user picks in its own folder picker (the Storage Access Framework), each granted
once and kept across restarts, and nothing else (author 2026-11-04, in place of All files access, which reads like a
file manager's and keeps an app off Google Play). The desktop's model stays: a folder setting and paths under it. On
Android the folder is the grant's tree address and a path under it is that address plus the relative path
(`content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FVault/Daily/a.md`).

- **Granting.** Settings' Choose… for the vault, data or documents folder opens Android's folder picker
  (`pickTreeFolder`); Open and Save As grant the documents folder the first time if none is granted.
- **Reaching.** `fileBridge.ts` sends every call on a tree path to `treeFs` (`androidFolders.ts`), which calls the app
  command `saf` (`src-tauri/src/saf.rs`), which runs the Kotlin plugin (`src-tauri/android/SafPlugin.kt`, copied
  into the generated project by `android-prep.mjs`). The plugin lists, walks, reads (whole or a head), writes, makes
  folders, renames over a file and tests for one, through `DocumentsContract`, off the main thread, keeping document
  ids by path so a deep path isn't found from the top each time. A whole vault is walked in one call (`walk`).
- **Reading as a person does.** A granted folder shows by its name on the phone (`treeLabel`: "Documents/Vault", an SD
  card's "SD card/…"), in Settings and as the picker's root; an Obsidian link names the vault by that folder.
- **Not yet:** a Parquet file in a granted folder (the shell's reader opens a path on disk; it answers `#N/A` saying
  so); opening a file in another app (File Link).

**What Tauri does on Android** (checked against the docs and the tauri, plugins-workspace and cargo-mobile2 sources,
2026-11-04): the app runs at `http://tauri.localhost` and IPC at `http://ipc.localhost`, which the CSP already allows;
the fs plugin reads and writes a single `content://` file (`readTextFile`, `writeTextFile`, `stat`) but can't
list, test, make or rename inside a granted folder, hence the folder plugin; the dialog plugin has no folder picker and answers
`open` and `save` with `content://` addresses; `net_fetch` fetches in Rust over rustls, so no OpenSSL and no
cleartext block; the opener's `openUrl` fires an Android VIEW intent (so `obsidian://` opens Obsidian), while
`openPath` and `revealItemInDir` don't work; the Tauri CLI points cargo at the NDK's clang, so `ring` and `zstd-sys`
build there (a plain `cargo build --target aarch64-linux-android` does not get that). The generated `MainActivity`
calls `enableEdgeToEdge()`, so the page draws under the status and navigation bars, and Tauri adds no inset handling;
Android System WebView reports those bars through `env(safe-area-inset-*)` for every WebView from M144 (for a
fullscreen one from M136), and the app already pads by those for the PWA. The back gesture goes back in the webview's
history and otherwise closes the app; `onBackButtonPress` in `@tauri-apps/api/app` (2.9 and up; the app has 2.12)
takes it over, under `core:default`. The manifest sets no `windowSoftInputMode`; from M139 the keyboard shrinks the
visual viewport, not the layout one. `additionalBrowserArgs` is Windows only and no Blink flag reaches Android's
WebView, so HTML-in-canvas is off there and the canvas falls back as the PWA's does. `bundle.fileAssociations` can
register the app for `.solenoid` files (not done). Kotlin reaches JavaScript through a mobile plugin (`@TauriPlugin`
with `@Command` methods, registered from Rust), not through `MainActivity`.

## Plan for the local agent

The agent runs on the author's Linux machine, on `develop`, with the phone (a Samsung S25+) on USB. Ground rules:

- The app's behavior doesn't change, only its packaging and what Android refuses. Every fix keeps desktop and web as
  they are: web code behind `isAndroidApp()`, Rust behind `#[cfg(mobile)]` / `#[cfg(desktop)]`.
- `npx tsc --noEmit -p .` and `npx vitest run` pass before each commit; one commit per phase on `develop`. Pushes wait
  for the author's word (CLAUDE.md, local dev server).
- The installed Tauri CLI's templates may differ from what § What Tauri does on Android read (the `dev` branch,
  2026-11-04): read the generated files rather than assume them, and note any difference in this file.
- **Documents live in the app's own storage**, so uninstalling the app deletes them. Before any `adb uninstall`
  (switching from a debug to a release build needs one, since the two are signed differently), save every document
  to a file.
- Stop and ask the author where a phase says so, and whenever a fix would change what the app does.

### Phase 0: the cloud build (before any local setup)

"Build (Android, debug)" (`.github/workflows/android-build.yml`) runs on every push to `develop` that touches
`src-tauri`, the manifest patch or the workflow, and by hand from the Actions tab. Green means the shell
compiles for Android and the APK, in the run's artifacts (`app-universal-debug.apk`), can be sideloaded at once
(Phase 4's list applies). Its log's only warnings are deprecations inside Tauri's generated Kotlin. Red is a
compile problem that a cloud session can fix from the run's log, the same way as Phase 3, before anyone installs
the toolchain.

### Phase 1: toolchain (the author or the agent, once)

1. Android Studio, with SDK Platform 37 (the Tauri template's `compileSdk`), Platform-Tools, Build-Tools, Command-line
   Tools and NDK (Side by side), from its SDK Manager.
2. In the shell profile: `JAVA_HOME` = Android Studio's bundled JBR (for example `/opt/android-studio/jbr`),
   `ANDROID_HOME="$HOME/Android/Sdk"`, `NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk)"`, and
   `$ANDROID_HOME/platform-tools` on `PATH`.
3. `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
4. The phone: Developer options, USB debugging on; `adb devices` lists it.

Done when `npx tauri info` shows the Android section with no missing pieces.

### Phase 2: generate the Android project

1. `npm ci`, then `npm run android:init` (Tauri writes `src-tauri/gen/android`, then `android-prep.mjs` patches its
   manifest; the script says "patched").
2. Android icons: `npx tauri icon src-tauri/icons/icon.png -o "$(mktemp -d)"`. The desktop set (and an iOS folder)
   go to the throwaway folder, so `src-tauri/icons` stays as it is; the Android mipmaps land in
   `gen/android/app/src/main/res/`. `git status` then shows changes under `gen/android` only.
3. Read the generated `.gitignore` files (they leave out `build`, `local.properties`, `keystore.properties`, the copied
   config and the `.so` libraries), then commit `src-tauri/gen/android`.

### Phase 3: first build

1. `npx tauri android build --apk --debug --target aarch64` (one ABI: the phone's, and the fastest build).
2. A compile error in `src-tauri` is the agent's to fix, behind `#[cfg(desktop)]` or `#[cfg(mobile)]` and never by
   removing a desktop feature. The likely ones: a desktop-only Tauri API left ungated in `lib.rs`; a plugin call that
   doesn't exist on mobile. Check the desktop shell still builds after the fix (`cargo check` in `src-tauri`).
3. An error inside a C crate (`ring`, `zstd-sys`) means the NDK isn't found: recheck `NDK_HOME`; don't set `CC` by hand.

Done when an APK exists: `find src-tauri/gen/android/app/build/outputs/apk -name '*.apk'`.

### Phase 4: run it on the phone

1. `adb install -r <the debug APK found above>`, then grant folders as a user would: Settings, Data, Choose… for the
   vault and the data folder (Android's folder picker; "Use this folder", then Allow).
2. For live edits, `npm run android:dev`: the CLI points the phone at the computer's LAN address through
   `TAURI_DEV_HOST`, so the two share a network and the computer takes inbound 1420 (the dev server) and 1421 (its hot
   reload). Inspect from desktop Chrome's `chrome://inspect`. Note the phone's WebView version
   (`navigator.userAgent`, the `Chrome/` number): the inset and keyboard checks below depend on it.
3. Walk this list, noting each result:
   - The app opens to the phone layout, with no desktop title bar or window buttons, and nothing under the status bar
     or the gesture bar (top bar, bottom toolbar, popups' edges), in portrait and landscape.
   - A seed document computes; a Formula, a chart and the Add menu work; a Script card runs (its worker).
   - Typing in a formula field near the bottom: the keyboard doesn't cover the field.
   - The back gesture: with Settings, the menu sheet, a table popup and a card's menu open, each closes in turn; on
     the bare canvas the app leaves, and reopening shows the last edit.
   - Web Source on an https URL, then on an http URL; Weather or FX fetches.
   - A shared (foreign) document still asks before it fetches or runs a script.
   - Settings' vault folder: Android's folder picker opens; grant the Obsidian vault, and Settings shows it by name
     ("Documents/Vault"). Close and reopen the app: the grant holds.
   - Vault Folder, Import Obsidian Note (the note picker, the preview, a reload), Local File with a CSV; a Parquet file
     says it can't be read from an Android folder yet. A big vault's note picker opens in a few seconds at most.
   - Write to Obsidian writes a note, and Obsidian shows it.
   - The Obsidian button on Import Obsidian Note opens the note in Obsidian.
   - Send the app to the background, swipe it away, reopen: the last edit is there.
   - Rotate to landscape: the tablet layout, scaled to fit.
   - The documents menu: Save As into Documents (the picker's name field, then Save), Save again (no picker), Open
     it back; Save As onto an existing file asks first. A table popup's CSV export and a Report's web page save the
     same way.

### Phase 5: what is expected to need work

- **Bars over the page.** The app's surfaces clear faked bars in Chromium (§ What is in place), so a surface under a
  real bar most likely means the phone's WebView is older than M144 (update Android System WebView from the Play Store first), or the surface lacks its
  `env(safe-area-inset-*)` padding (add it, as the PWA's other surfaces have it). If the WebView can't be updated, a
  `ViewCompat.setOnApplyWindowInsetsListener` in `MainActivity` pads the content by the system bars and display cutout,
  and returns those insets zeroed (not consumed) so the CSS doesn't pad twice.
- **The keyboard over a field.** Below M139 the keyboard may cover the field. If it does on the phone's WebView, scroll
  the focused field into view on `visualViewport` resize, behind `isAndroidApp()`, without clearing focus (that closes
  the keyboard again).
- **Anything in the Phase 4 list that fails** and isn't listed here: fix it behind `isAndroidApp()` when the fix is
  packaging; stop and ask when the fix would change what the app does.

### Phase 6: a release APK

1. A signing key: `keytool -genkey -v -keystore ~/solenoid-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
   (kept outside the repository; the author holds the passwords).
2. `src-tauri/gen/android/keystore.properties` (`password`, `keyAlias`, `storeFile`; git-ignored), and in
   `app/build.gradle.kts` a `signingConfigs { create("release") { … } }` read from it, set on the `release` build type
   (Tauri's guide: https://v2.tauri.app/distribute/sign/android/).
3. `npm run android:build -- --target aarch64` (or all four ABIs, universal by default; `--split-per-abi` for one APK
   each).
4. Install it on the phone and repeat the Phase 4 list quickly.

### Phase 7: wrap up

Update this file: § Status, what Phase 5 fixed, and anything Tauri did differently from § What Tauri does on Android.
Delete the backlog line, extend the dev-notes digest, and push `develop` when the author says to.

**Not in this plan** (backlog items if the author wants them): opening a `.solenoid` file from another app
(`bundle.fileAssociations`), a Play Store release (signing for the store and its listing), iOS.
