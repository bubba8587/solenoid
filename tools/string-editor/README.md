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
npm install                 # once, installs playwright-core (pinned to match the local Chromium)
node up.mjs                 # kills any old instance, starts fresh, opens the window
```

`up.mjs` is the real launcher: it kills whatever is listening on port 5599 (so you always
get the *current* code — no stale server serving an old UI), starts the server detached,
waits until it answers, and opens **http://localhost:5599** in your browser automatically.
The page auto-scans on load.

`npm start` (plain `node server.mjs`) also works if you'd rather run it in the foreground
and open the URL yourself.

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

Editing a single-match string rewrites that one source literal, so **every** on-screen
instance rendered from it changes together. Ambiguous strings offer per-file radios plus
"edit all N".

## Copy-edit log

Every successful save appends one JSON line to **`copy-edits.jsonl`** (created lazily on the
first real write; tracked in git). Each record is
`{ ts, file, line, from, to, context?, status? }` — a durable trail of the author's copy/voice
edits that a later session can read to learn their wording preferences. Failed or no-op saves
are never logged, and a logging failure never blocks the source rewrite.

## Controls

- **Rescan app** — re-reads the running app (re-launches Chromium).
- **Filter box** — substring filter over the visible strings.
- **1 match / many matches / not in source** chips — toggle which classes are listed.
- **Save** (or Enter in the field) — writes the change. For ambiguous strings, pick "edit
  all N" or a single file first.

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
