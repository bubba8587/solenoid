Start the Solenoid Vite dev server for THIS worktree (react-port-develop) on port 1430 and confirm it's running.

This folder is a git worktree beside the main `solenoid` checkout, whose dev server owns port 1420. Never use 1420 here.

Run in the FOREGROUND (not as a background task): `node scripts/dev-up.mjs --port 1430`

The script starts vite detached, waits until http://localhost:1430 actually
answers, then exits. It is idempotent (an already-running server on 1430 is a
no-op) and prints the log path on failure. Stop only this server later with
`npx kill-port 1430` (a bare `pkill -f vite` would also kill the main repo's server).

After it exits 0, tell the user the app is available at http://localhost:1430
