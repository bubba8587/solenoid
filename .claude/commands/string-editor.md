Launch the string-editor companion: a local window that lists the strings
currently on screen in the running app and writes edits back to the source files.

Steps:

1. If `tools/string-editor/node_modules` is missing, install first (one time):
   `cd tools/string-editor && npm install` (pulls playwright-core from the local
   npm cache; offline is fine).

2. Start it in the FOREGROUND (not a background task): `node tools/string-editor/up.mjs`
   The script KILLS any editor already on port 5599, starts a FRESH server (so the
   latest code is always served — not idempotent, by design), waits until
   http://localhost:5599 answers, then opens a browser window to it. It exits once
   the window is open. Stop it later with `pkill -f '[s]erver.mjs'`.

3. The editor SCRAPES the running app, so the Solenoid dev server must be up on
   http://localhost:1420. If it isn't, run `/startup` first.

After up.mjs exits 0 the editor window is already open at http://localhost:5599.
It auto-scans on load; the Rescan button re-reads the app. Editing a string and
Saving rewrites the source literal (Vite HMR reflects it live) and appends the
change to `tools/string-editor/copy-edits.jsonl` — the running record of the
author's copy/voice edits.

By default the editor launches its OWN browser, which shows the app's DEFAULT
state (a fresh load), not the author's live document — the page shows a warning
banner ("default state") when that happens. To edit their LIVE tab, the author
must relaunch their browser with `--remote-debugging-port=9222` (normal profile,
so autosave restores their doc) and Rescan; the editor then attaches over CDP and
the header shows "live tab". See `tools/string-editor/README.md` → "Reading YOUR
live document". If the user reports seeing the wrong (default) content, this is why.
