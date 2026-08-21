# Solenoid String Editor

A standalone local **WYSIWYG copy-editing companion** for the Solenoid app. It opens in
its own browser window, reads the *running* dev server, lists every string currently
visible on screen, and lets you rewrite any of them straight into the project's source
files. Vite HMR then reflects the change live.

It never starts, stops, or touches the dev server — it only reads it.

## Launch

The Solenoid dev server must already be running on **http://localhost:1420**
(`npm run dev` from the repo root).

```
cd tools/string-editor
npm install          # once, installs playwright-core (pinned to match the local Chromium)
npm start            # -> serves http://localhost:5599
```

Then open **http://localhost:5599** in a browser window. It auto-scans on load.

## How it works

1. **Scrape** — launches the preinstalled Playwright Chromium
   (`chromium-1223`), navigates to localhost:1420, waits for the app to render, and
   collects every visible, human-readable text run (plus `title` / `placeholder` /
   `aria-label` attribute strings). Pure numbers, single glyphs, whitespace and icons are
   dropped. Each string keeps a light context (tag + short CSS path + any `data-*`).

2. **Map to source** — scans `src/**/*.{ts,tsx,md}`, extracts every string literal
   (`"..."`, `'...'`, non-interpolated `` `...` ``) decoded through its escapes, and `.md`
   text. Each on-screen string is classified:
   - **editable** — exactly one source literal matches.
   - **ambiguous** — several literals match; the row lets you edit one chosen file or all.
   - **not in source** — no literal matches (dynamic, interpolated, or document content);
     shown read-only.

3. **Write back** — Save rewrites only the literal's *contents*, rebuilding the quotes and
   re-escaping correctly for the quote style (quotes, backslashes, newlines, and `${` inside
   template literals). It verifies the original text is still in place before writing, and
   refuses if the position became ambiguous (e.g. the file changed under it) — so it never
   silently edits the wrong place.

## Controls

- **Rescan app** — re-reads the running app (re-launches Chromium).
- **Filter box** — substring filter over the visible strings.
- **editable / ambiguous / not found** chips — toggle which classes are listed.
- **Save** (or Enter in the field) — writes the change. For ambiguous strings, pick "edit
  ALL occurrences" or a single file first.

## Limitations

- Strings assembled at runtime (interpolated, computed, concatenated, or user-document
  content like node labels and cell values) have no single source literal, so they list as
  **not in source** and are read-only.
- Template literals containing `${...}` are never matched (their runtime value isn't a fixed
  literal).
- `.md` matches are plain substring matches; a very common phrase may report several `.md`
  locations.
- The Chromium path is Windows-specific
  (`chromium-1223/chrome-win64/chrome.exe`) and `playwright-core` is pinned to the version
  that ships that revision. `npm install` pulls it from the local npm cache when offline.
