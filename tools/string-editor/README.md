# Solenoid String Editor

> **In-app shortcut:** on the dev server you can skip this window entirely — press
> **Ctrl+Alt+E** in the running app to freeze it and edit any on-screen string in
> place (`src/devCopyEdit.ts`). Commits post to the Vite `/__copy-edit` endpoint
> (`vite.config.ts`), which reuses this tool's mapper (`literals.mjs`) — same
> drift-safe rewrite, same `copy-edits.jsonl` log. The lookup is markdown-aware
> (a rendered description or help paragraph resolves back to its marked-up source,
> which is what you edit), and a save rewrites **every** source place the string
> appears. Strings with no source literal (dynamic, interpolated, document content)
> report on the badge and are left alone — this window remains the tool for those.

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

## Reading YOUR live document (not the default seed)

By default the editor launches its **own** headless browser and loads the app fresh. A fresh
browser has empty storage, so it only ever sees the app's **default state** (the Getting
Started seed) — never the document you have open in your own browser, which lives in *your*
browser's autosave. When this happens the page shows a warning banner and the header omits
"live tab".

To edit what you *actually* see, let the editor attach to a real browser over the Chrome
DevTools Protocol. Chrome/Edge 136+ **ignore `--remote-debugging-port` on the default
profile**, so a bare `chrome.exe --remote-debugging-port=9222` silently does nothing.
Use the launcher instead:

```
node tools/string-editor/debug-browser.mjs
```

It starts Chrome (or Edge) on a separate `solenoid-cdp-profile` with debugging on, seeded
the first time from your real profile's `localhost:1420` local storage — so autosave
restores the document you were working on. The profile persists, so later runs keep
whatever you did in it; pass `--reseed` to re-copy from your real profile. Then click
**Rescan** in the editor; the header should read "· live tab".

Work done in the debug window lives in that debug profile, not your everyday one.

The debug endpoint defaults to `http://localhost:9222` (override with `SOLENOID_CDP`). The
editor only reads the tab — it never navigates or changes it — and disconnects cleanly after
each scan, leaving your browser running.

## How it works

1. **Scrape** — first tries to **attach to your own browser** over CDP (see above) and read
   the app tab as-is (`source: live`); if no debug browser is reachable it falls back to
   launching the preinstalled Playwright Chromium (`chromium-1223`) and loading the app fresh
   (`source: fresh`, the default state). Either way it collects every visible, human-readable
   text run (plus `title` / `placeholder` / `aria-label` attribute strings); pure numbers,
   single glyphs, whitespace and icons are dropped. Each string keeps a light context
   (tag + short CSS path + any `data-*`).

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

- **Rescan app** — re-reads the running app (attaches to your browser if it exposes a debug
  port, otherwise launches its own Chromium).
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
