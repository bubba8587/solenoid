Start the Solenoid Vite dev server on port 1420 and confirm it's running.

Run in the FOREGROUND (not as a background task): `node scripts/dev-up.mjs`

The script starts vite detached, waits until http://localhost:1420 actually
answers, then exits — so the task finishes instead of lingering as a
never-ending background job. It is idempotent (an already-running server is a
no-op) and prints the log path on failure. Stop the server later with
`pkill -f '[v]ite'`.

After it exits 0, tell the user the app is available at http://localhost:1420
