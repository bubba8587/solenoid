Launch the string-editor companion: a local window that lists the strings
currently on screen in the running app and writes edits back to the source files.

Steps:

1. If `tools/string-editor/node_modules` is missing, install first (one time):
   `cd tools/string-editor && npm install` (pulls playwright-core from the local
   npm cache; offline is fine).

2. Start it in the FOREGROUND (not a background task): `node tools/string-editor/up.mjs`
   The script starts the editor server (port 5599) detached, waits until
   http://localhost:5599 answers, then exits — so the task finishes instead of
   lingering. It is idempotent (an already-running editor is a no-op). Stop it later
   with `pkill -f '[s]erver.mjs'`.

3. The editor SCRAPES the running app, so the Solenoid dev server must be up on
   http://localhost:1420. If it isn't, run `/startup` first.

After up.mjs exits 0, tell the user to open http://localhost:5599 in a browser
window. It auto-scans on load; the Rescan button re-reads the app. Editing a
string and Saving rewrites the source literal (Vite HMR reflects it live).
