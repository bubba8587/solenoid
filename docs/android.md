# Android app: preparation and first build

<!-- [[B2]] webTryDesktopFull: the Android app is the full app in a phone's shell. -->

**Status (2026-11-04):** prepared, never built. The repository holds everything that doesn't need the Android
toolchain; the first build and the checks below happen on the author's machine. The app is the desktop app,
packaged: Tauri 2 builds Android from the same `src-tauri`, so the cards behave as they do on desktop and the screen
is the phone layout the web app already has. Nothing about the app changes; only what a phone lacks (a window frame,
a file manager) or does differently (picking files, storage permission) is handled.

## What is in place

| Piece | Where |
|---|---|
| The window frame, Linux shims and debug icon run on desktop only; `tauri-plugin-decorum` is a desktop-only dependency | `src-tauri/src/lib.rs` (`desktop_window`), `src-tauri/Cargo.toml` |
| `open_devtools` and `toggle_fullscreen` do nothing on a phone (the webview is inspected from a computer's `chrome://inspect`) | `src-tauri/src/lib.rs` |
| Permissions: the desktop file is `platforms: linux, macOS, windows`; Android has its own, the same file and network grants scoped to shared storage (`/storage/emulated/0`), no window permissions | `src-tauri/capabilities/default.json`, `android.json` |
| `isAndroidApp()`: the Tauri shell on Android. `isDesktop()` stays true there, since it means "has the desktop's files and network" | `src/graph/fileBridge.ts` |
| `html[data-shell="android"]`, so the desktop frame's CSS stays off; no F11, F12 or window border calls; no "Open documents folder" | `src/main.tsx`, `fullscreen.ts`, `devtoolsHotkey.ts`, `nativeAccent.ts`, `menuModel.ts` |
| Picking a file or folder uses the app's own picker over the real files, because Android's picker answers with a `content://` address the file calls can't read; a folder (Settings' folder rows) is picked from shared storage, three levels deep | `chooseFile.ts`, `pickFolderDialog` in `fileBridge.ts` |
| Leaving the app saves (Android can end a backgrounded app without a `pagehide`) | `persistence.ts` |
| Settings, Data says where to turn on All files access | `Settings.tsx` (`AndroidFilesRow`) |
| The manifest patch: All files access, the legacy storage permissions, plain-http fetches; idempotent, run by the npm scripts | `scripts/android-prep.mjs`, `tests/graph/androidPrep.test.ts` |

**Files reach shared storage by path, through All files access** (`MANAGE_EXTERNAL_STORAGE`). The user turns it on
once: Android Settings, Apps, Solenoid, Permissions, Files. That keeps the desktop's model (a folder and the paths
under it) for Local File, Vault Folder, the Obsidian cards and the writes. It suits a sideloaded APK; Google Play
admits that permission only for apps whose main job is managing files, so a Play release would need the Storage
Access Framework instead (a small native plugin to walk a granted folder), which is a separate project.

## First build (author's machine)

1. Install Android Studio (or the command-line tools) with the SDK, the NDK and Java 17; set `ANDROID_HOME` and
   `NDK_HOME`. Add the Rust targets:
   `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
2. `npm run android:init`: Tauri generates `src-tauri/gen/android`, then the manifest is patched. Commit the
   generated project.
3. `npm run android:dev` runs it on a plugged-in phone or an emulator, against the dev server (`vite.config.ts`
   already serves on `TAURI_DEV_HOST`).
4. `npm run android:build` builds the APK. A release APK needs a signing key (Tauri's Android signing guide); a
   debug APK installs as is.

## Check on the first build

- The shell compiles for Android (checked only for desktop here: the Android check needs the NDK, since `ring` and
  the Parquet reader's compression libraries build C).
- A connection card fetches (Web Source on an https and an http URL).
- With All files access on: Settings' vault folder picks through the app's picker; Vault Folder, Import Obsidian
  Note, Local File (CSV and Parquet) read; Write to Obsidian and Save write.
- Opening and saving a `.solenoid` file through the document menu: these still use the system picker, whose
  `content://` answer the file calls may not read. If they fail, they move to the app's picker as folders did.
- An Obsidian link opens Obsidian; a File Link card's open (the opener on Android) works or is hidden.
- The app saves when sent to the background and killed.
