# Android app: preparation and the local agent's plan

<!-- [[B2]] webTryDesktopFull: the Android app is the full app in a phone's shell. -->

**Status (2026-11-04):** prepared in a cloud session, never built. Everything that doesn't need the Android toolchain is
in the repository; a local agent on the author's Linux machine does the build, following § Plan below. The app is the
desktop app, packaged: Tauri 2 builds Android from the same `src-tauri`, so the cards behave as on desktop and the
screen is the phone layout the web app already has. Only what a phone lacks (a window frame, a file manager) or does
differently (pickers, storage permission) is handled.

## What is in place

| Piece | Where |
|---|---|
| The window frame, Linux shims and debug icon run on desktop only; `tauri-plugin-decorum` is a desktop-only dependency | `src-tauri/src/lib.rs` (`desktop_window`), `src-tauri/Cargo.toml` |
| `open_devtools` and `toggle_fullscreen` do nothing on a phone (the webview is inspected from a computer's `chrome://inspect`) | `src-tauri/src/lib.rs` |
| Android 11 and up (`minSdkVersion` 30), so storage is All files access only, with no legacy permissions | `src-tauri/tauri.conf.json` `bundle.android` |
| Permissions: the desktop file is `platforms: linux, macOS, windows`; Android has its own, the desktop's file and network grants scoped to shared storage (`/storage/emulated/0`), no window permissions | `src-tauri/capabilities/default.json`, `android.json` |
| `isAndroidApp()`: the Tauri shell on Android. `isDesktop()` stays true there, since it means "has the desktop's files and network" | `src/graph/fileBridge.ts` |
| `html[data-shell="android"]`, so the desktop frame's CSS stays off; no F11, F12 or window border calls; no "Open documents folder" | `src/main.tsx`, `fullscreen.ts`, `devtoolsHotkey.ts`, `nativeAccent.ts`, `menuModel.ts` |
| A card's file and every folder are picked in the app's own picker over the real files: Android's picker has no folder mode and answers a file with a `content://` address the folder calls can't read. Settings' folder rows browse shared storage three levels deep | `chooseFile.ts`, `pickFolderDialog` in `fileBridge.ts` |
| Opening a file in another app (File Link) says it isn't available: the opener hands Android a `file://` address, which Android refuses | `openFilePath` in `fileBridge.ts` |
| Leaving the app saves (Android can end a backgrounded app without a `pagehide`) | `persistence.ts` |
| Settings, Data says where to turn on All files access | `Settings.tsx` (`AndroidFilesRow`) |
| The manifest patch: All files access, plain http in release too; idempotent, run by the npm scripts | `scripts/android-prep.mjs`, `tests/graph/androidPrep.test.ts` |

**Files reach shared storage by path, through All files access** (`MANAGE_EXTERNAL_STORAGE`). The user turns it on
once: Android Settings, Apps, Special app access, All files access (for a test install,
`adb shell appops set --uid com.solenoid.app MANAGE_EXTERNAL_STORAGE allow`). That keeps the desktop's model (a folder
and the paths under it) for Local File, Vault Folder, the Obsidian cards and the writes. It suits a sideloaded APK;
Google Play admits the permission only for apps whose main job is managing files, so a Play release needs the Storage
Access Framework instead (a native plugin to walk a granted folder), a separate project.

**What Tauri does on Android** (checked against the docs and the tauri, plugins-workspace and cargo-mobile2 sources,
2026-11-04): the app runs at `http://tauri.localhost` and IPC at `http://ipc.localhost`, which the CSP already allows;
the fs plugin's `$HOME` is `/storage/emulated/0`, and it reads and writes a `content://` file (`readTextFile`,
`writeTextFile`, `stat`) but can't list, test, make or rename one; the dialog plugin has no folder picker and answers
`open` and `save` with `content://` addresses; the http plugin fetches in Rust over rustls, so no OpenSSL and no
cleartext block; the opener's `openUrl` fires an Android VIEW intent (so `obsidian://` opens Obsidian), while
`openPath` and `revealItemInDir` don't work; the Tauri CLI points cargo at the NDK's clang, so `ring` and `zstd-sys`
build there (a plain `cargo build --target aarch64-linux-android` does not get that).

## Plan for the local agent

The agent runs on the author's Linux machine, on `develop`, with the phone (a Samsung S25+) on USB. Ground rules: the
app's behavior doesn't change, only its packaging and what Android refuses; every fix keeps desktop and web as they are
(`isAndroidApp()` gates it); `npx tsc --noEmit -p .` and `npx vitest run` pass before each commit; commits go to
`develop`, one per phase. Stop and ask the author where a phase says so.

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
2. Android icons: `npx tauri icon src-tauri/icons/icon.png`, then `git checkout -- src-tauri/icons` so the desktop icons
   stay as they are; the mipmaps land in `gen/android/app/src/main/res/`.
3. Read the generated `.gitignore` files (they leave out `build`, `local.properties`, `keystore.properties`, the copied
   config and the `.so` libraries), then commit `src-tauri/gen/android`.

### Phase 3: first build

1. `npx tauri android build --apk --debug --target aarch64` (one ABI: the phone's, and the fastest build).
2. A compile error in `src-tauri` is the agent's to fix, behind `#[cfg(desktop)]` or `#[cfg(mobile)]` and never by
   removing a desktop feature. The likely ones: a desktop-only Tauri API left ungated in `lib.rs`; a plugin call that
   doesn't exist on mobile. Check the desktop shell still builds after the fix (`cargo check` in `src-tauri`).
3. An error inside a C crate (`ring`, `zstd-sys`) means the NDK isn't found: recheck `NDK_HOME`; don't set `CC` by hand.

Done when the APK exists under `src-tauri/gen/android/app/build/outputs/apk/`.

### Phase 4: run it on the phone

1. `adb install -r <the debug APK>`, then grant storage for testing:
   `adb shell appops set --uid com.solenoid.app MANAGE_EXTERNAL_STORAGE allow`.
2. For live edits, `npm run android:dev` (the CLI points the phone at the dev server's LAN address through
   `TAURI_DEV_HOST`; the phone and the computer share a network). Inspect from desktop Chrome's `chrome://inspect`.
3. Walk this list, noting each result:
   - The app opens to the phone layout, with no desktop title bar or window buttons.
   - A seed document computes; a Formula, a chart and the Add menu work.
   - Web Source on an https URL, then on an http URL; Weather or FX fetches.
   - A shared (foreign) document still asks before it fetches or runs a script.
   - Settings' vault folder: the app's picker lists the phone's folders; pick the Obsidian vault.
   - Vault Folder, Import Obsidian Note (the note picker, the preview, a reload), Local File with a CSV and with a
     Parquet file.
   - Write to Obsidian writes a note, and Obsidian shows it.
   - The Obsidian button on Import Obsidian Note opens the note in Obsidian.
   - Send the app to the background, swipe it away, reopen: the last edit is there.
   - Rotate to landscape: the tablet layout, scaled to fit.
   - The documents menu: Open a `.solenoid` file, Save As, Save (see Phase 5).

### Phase 5: what is expected to need work

- **Opening and saving a document file.** The system picker answers with a `content://` address. Reading one works,
  and a save falls back from its temporary file (which can't be renamed there) to writing in place, so both may work;
  the file name shown will be Android's id, not the name, and images can't be bundled beside it. If any of that
  fails or reads badly, stop and ask the author between: (a) on Android, Save As picks a folder and a name in the app
  (the documents folder on shared storage), so a document is a real path like on desktop; (b) keep the system picker
  and show the name Android reports.
- **The All files access screen.** The app can't open it or check the grant without native code (the opener sends only
  VIEW intents). If the author wants a button, add a small Kotlin call in `MainActivity` for
  `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` and `Environment.isExternalStorageManager()`, exposed as a
  Tauri command; otherwise the Settings line stays the instructions.
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

Update this file: § Status, what Phase 5 decided, and anything Tauri did differently from § What Tauri does on Android.
Delete the backlog line, extend the dev-notes digest, push `develop`.
