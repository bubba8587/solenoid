Sync with the coordination board and continue by your role.

Do this now:

1. **Read `docs/agent-coordination.md` fresh** (another agent may have edited it).

2. **Act as your established agent role** (Agent 1 is Lead). If you're unsure which
   agent you are, infer it from the Active-claims block matching your recent work
   and say which you concluded.

3. **Follow the Editing rules + Shared-file policy** in that doc.

4. **Housekeeping (do this now regardless of role):**
   - Move only **author-OK'd** finished claims to your own Recently-done subsection.
     Work that's done-but-unreviewed stays put as `DONE — awaiting author OK` in your
     Active-claims block — do NOT queue its commit yet (author-OK gate; see the doc).
   - **Agent 3:** flush the Commit queue first (FIFO, stage only the named files,
     NEVER push, log SHAs) — this is your service role, not "your task". The queue only
     holds author-OK'd items (plus your own pre-authorized mechanical work).
   - **Lead (Agent 1):** keep Agent 3's QUEUE fed (stack one vetted low-level task
     if it's empty), **keep Agent 2's staged QUEUE fed (≥1, top toward 2 — the author
     does NOT bump A2, so an empty A2 queue strands her)**, and tidy the Task pool.
     If A2's lane has no approved in-lane item left, surface that to the author this
     turn rather than leave her idle.

5. **By role — what to do next:**

   - **Agent 1 (Lead):** After housekeeping, **STOP and report** before executing
     your own task. Write your claim in your block, give a terse per-agent status
     line, then wait for the user to bump you before starting work.
     **HARD PRECONDITION: do NOT stop / await a bump while Agent 2's queue is empty.**
     The author doesn't drive A2 — if you park yourself with A2 starved, she idles
     until the author notices. Feed A2 (or surface "A2 lane dry — pick her next") FIRST.
     Report format: `A1: 1 claimed (X) · A2: N staged (or DONE—awaiting OK) · A3: N queued · commits: N`

   - **Agent 2 / Agent 3:** After housekeeping, **proceed immediately** with your
     claimed or queued task. No checkpoint needed — just do it and report what you
     completed when done.

If nothing is actionable, say so in one line. Stop and ask the user only at a real
decision point.
