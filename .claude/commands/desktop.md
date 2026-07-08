Launch the locally built Solenoid desktop app (the release exe from `npm run release:desktop`).

Run (PowerShell): `Start-Process "$env:USERPROFILE\.cargo-target\release\solenoid.exe"`

Notes:
- The cargo target dir on the dev machine is redirected to `~\.cargo-target` (not `src-tauri\target`), which is why the exe lives there.
- If the exe is missing, say so and offer to build it with `npm run release:desktop` — don't build unprompted.
- Launch detached (`Start-Process`), never run the exe in the foreground of the shell.
