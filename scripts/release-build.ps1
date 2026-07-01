# Clean release build for the Windows desktop app.
#
# Rust bakes absolute source paths into panic locations, and for registry deps those
# look like `C:\Users\<username>\.cargo\registry\...` — which leaks the build machine's
# username into the SHIPPED binary. `--remap-path-prefix` rewrites the user-home prefix
# (where both the cargo registry and the workspace live) to a neutral path, so the
# artifact carries no local path.
#
# Notes:
#  - CARGO_ENCODED_RUSTFLAGS (not RUSTFLAGS) is used because a home path can contain a
#    space (e.g. "C:\Users\First Last"), which RUSTFLAGS' whitespace-splitting breaks.
#  - The prefix comes from $env:USERPROFILE at build time, so nothing hardcodes a name.
#  - `[profile.release] trim-paths` would be the idiomatic fix but is not stable in the
#    pinned Cargo, so we remap explicitly.
#
# Verify a cut is clean:
#   grep -a -c "$env:USERNAME" src-tauri\target\release\solenoid.exe   # must print 0
$ErrorActionPreference = "Stop"
$env:CARGO_ENCODED_RUSTFLAGS = "--remap-path-prefix=$env:USERPROFILE=C:\build"
npm run tauri build
