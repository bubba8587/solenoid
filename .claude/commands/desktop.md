Launch the locally built Solenoid desktop app (the release binary from `npm run release:desktop`).

Run: `setsid -f ~/.cargo-target/release/solenoid`

Notes:
- The cargo target dir on the dev machine is redirected to `~/.cargo-target` (`~/.cargo/config.toml`, not `src-tauri/target`), which is why the binary lives there.
- If the binary is missing, say so and offer to build it with `npm run release:desktop` — don't build unprompted.
- Launch detached (`setsid -f`), never run the binary in the foreground of the shell.
- The debug build (`npm run desktop:debug`) lands at `~/.cargo-target/debug/solenoid`, wears the bug-badged icon, and is NOT self-contained: it loads the dev server at localhost:1420 (run `/startup` first). `tauri build --debug` would embed `dist/` instead, so don't build it that way. Launch the debug app only when asked for it.
