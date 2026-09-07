---
type: solenoid
nodes: [Sync project health, Daily habits]
updated: 2026-09-07T09:00:00
---
# Demo vault

The Solenoid graph that computes over this vault. Backlinks below answer "which graph
wrote this", and a Bases view over `Solenoid/` lists every graph touching the vault.

- **Sync project health** writes a `health` property back onto each note in
  [[Projects/Kitchen remodel]] and its siblings.
- **Daily habits** reads [[Daily/2026-09-07]] and the rest of the folder as a time series.

Run from Solenoid, or headless: `run-graph demo-vault.solenoid --vault . --run "Sync project health"`.
