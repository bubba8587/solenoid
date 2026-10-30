# Working on the bleeding-edge branch

The `bleeding-edge` branch exists to run Solenoid on the newest of everything: every dependency at its newest release and the newest web-platform features put to use. Breaking a browser that lacks a feature is fine here; finding out what breaks is the point. The author doesn't direct this branch. The author reads what landed, then ports what's worth keeping to a work branch, one commit at a time.

## Standing orders

1. **Act, don't ask.** An agent working on this branch implements, commits and pushes on its own judgment. It never asks the author to choose between experiments, approve one, or say which feature goes first. A question to the author on this branch is a failure of these orders; the answer is always "do everything within reason, then report".
2. **Within reason** means all of these hold:
   - The look and the behavior stay the same, or are clearly better: more accessible, crisper, faster, fewer lines, a bug class gone. A change that only swaps one look for another of equal merit is out.
   - The change replaces something the app already does by hand (a JS measurement, a hand-written ladder of rules, a workaround) or improves something it already has. A new product feature, a new look, or anything that needs the author's taste is out; it goes in the ledger as a candidate instead.
   - Nothing in the decision tree changes. A platform feature is never a leaf.
3. **Use the native feature for real.** Delete the workaround it replaces. No `@supports` fallback, no JS fallback, no polyfill: a browser without the feature shows the breakage, and the ledger says which browsers that is.
4. **One feature, one commit**, named `Edge: <feature>: <what it replaces>`, small enough to port to a work branch on its own. A feature that touches many files is still one commit.
5. **Checks per commit.** The typecheck and the unit tests must not regress because of the commit (a failure a dependency bump caused is fixed in its own `Fix:` commit or reported, never skipped), and the push waits on them: chain it after the test run, so a red run never leaves the machine. A change anyone could see is screenshotted in Chromium, in both themes, on a phone and on a desktop, and compared with the base before it's pushed.
6. **Keep the ledger.** Every feature tried gets a row in `EXPERIMENTS.md` on this branch: the feature, the commit, what it replaced, which engines lack it (Firefox, Safari, WebKitGTK on the Linux desktop, the Obsidian plugin's Electron), and whether it changed the look. Candidates that were out of reason get a row too, with why.
7. **Start every session the same way:** rebase onto the newest work (`node .github/bleeding-edge/bleeding-edge.mjs --rebase-only`, then push), read the ledger, then work down the newest release notes (Chrome's release notes and the "What's new in web UI" round-ups, web.dev's monthly "New to the web platform", the Interop dashboard) for anything not yet in the ledger.
8. **Never merge this branch into a work branch.** A change that proves itself moves over as its own commit, on the author's word.

## What breaks is the result

The daily report (`REPORT.md`) says which checks fail after the dependency bumps; the ledger says which engines each feature leaves behind. Neither is a reason to hold back an experiment. Both are what the author reads to decide what to port.
