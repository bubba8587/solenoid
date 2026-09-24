# Agent coordination

The protocol for parallel agent sessions. Dormant in a solo session: claim nothing.

- **One test run at a time.** Only one `tsc` or `vitest` run happens at once, arbitrated by the file
  `.dev/test-lock` in the main checkout. Read it: if it says `free`, write your session name, run,
  then write `free` back; if it holds someone else's name, do other work and retry. A second run at
  the same time crashes the author's machine.
- **Claims** are one line each in this file, deleted when the work lands. Agents message each other
  directly for live coordination; the board holds only what must survive a restart.
- **The Lead merges.** Agent 1 is the Lead. Peers commit on their worktree branches and send the
  Lead a commit hash once it is green; the Lead merges into `develop` ([[C41]] branchModel), and
  nobody else pushes.
- **Reopen if** the test lock stops being a machine constraint, or the branch model changes.

## Claims

