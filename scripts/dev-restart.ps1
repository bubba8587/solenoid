# Restart the Solenoid desktop app: kill the running instance, wait for the exe
# lock to release, rebuild (debug, no installer), and relaunch detached.
#
#   powershell scripts/dev-restart.ps1            # rebuild + restart
#   powershell scripts/dev-restart.ps1 -NoBuild   # just kill + relaunch (no rebuild)
param([switch]$NoBuild)

$ErrorActionPreference = "Stop"
$exe = "src-tauri\target\debug\solenoid.exe"

# 1. Kill the running app (if any) so the linker can overwrite the locked exe.
Stop-Process -Name solenoid -Force -ErrorAction SilentlyContinue

# 2. Wait a beat for the process + file handle to fully release.
Start-Sleep -Seconds 1

# 3. Rebuild unless skipped.
if (-not $NoBuild) {
    npx tauri build --debug --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
}

# 4. Relaunch detached so it keeps running after this script returns.
if (-not (Test-Path $exe)) { throw "missing $exe - build first (run without -NoBuild)" }
Start-Process $exe
Write-Output "Solenoid restarted."
