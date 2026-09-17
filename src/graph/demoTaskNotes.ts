// [[D62]]
// Fake TaskNotes replies, the way demoVault fakes the vault: the marketing /obsidian page
// forces them, and an app with no TaskNotes URL configured reads them while the "Use demo
// vault" setting allows it (demoVaultResolution),
// so the TaskNotes node shows a real Tasks cube (and events/stats) without a running
// TaskNotes HTTP API. The node routes to these canned replies — parsed by the SAME
// taskNotesApi parsers as the real API — instead of the network. Writes are never faked.
import { settingsStore } from "./settingsStore";

let _forced = false;

/** Pin the TaskNotes node to the canned demo replies (true), or clear it (false). */
export function forceDemoTaskNotes(on: boolean): void { _forced = on; }

/** Is the TaskNotes node reading the canned demo data instead of the network? */
export function isDemoTaskNotes(): boolean {
  return _forced || (settingsStore.get("useDemoVault") && settingsStore.get("taskNotesUrl").trim() === "");
}

// Shaped exactly like a real `GET /api/tasks` page; the parser reads `.tasks` +
// `.pagination`. Fixed dates so the demo is stable across sessions.
export const DEMO_TASKS_JSON = JSON.stringify({
  tasks: [
    { path: "Tasks/Draft the vault README.md", title: "Draft the vault README", status: "in-progress", priority: "high", due: "2026-09-18", scheduled: "2026-09-16", timeEstimate: 90, totalTrackedTime: 55, projects: ["Docs"], contexts: ["writing"], tags: ["task"] },
    { path: "Tasks/Review pull requests.md", title: "Review pull requests", status: "open", priority: "normal", due: "2026-09-17", timeEstimate: 45, totalTrackedTime: 0, projects: ["Solenoid"], contexts: ["code"], tags: ["task"] },
    { path: "Tasks/Plan Q4 roadmap.md", title: "Plan Q4 roadmap", status: "open", priority: "high", due: "2026-09-25", scheduled: "2026-09-22", timeEstimate: 120, totalTrackedTime: 0, projects: ["Planning"], contexts: ["deep-work"], tags: ["task"] },
    { path: "Tasks/Fix cable routing bug.md", title: "Fix cable routing bug", status: "done", priority: "high", due: "2026-09-12", completedDate: "2026-09-11", timeEstimate: 60, totalTrackedTime: 75, projects: ["Solenoid"], contexts: ["code"], tags: ["task"] },
    { path: "Tasks/Water the garden.md", title: "Water the garden", status: "done", priority: "low", due: "2026-09-14", completedDate: "2026-09-14", timeEstimate: 15, totalTrackedTime: 12, projects: ["Home"], contexts: ["errand"], tags: ["task"] },
    { path: "Tasks/Write weekly review.md", title: "Write weekly review", status: "open", priority: "normal", scheduled: "2026-09-19", timeEstimate: 30, totalTrackedTime: 0, projects: ["Docs"], contexts: ["writing"], tags: ["task"] },
    // The kitchen remodel: a chain with a diamond, in minutes of estimate (8 h = a day).
    { path: "Tasks/Demolition.md", title: "Demolition", status: "done", priority: "high", due: "2026-09-19", completedDate: "2026-09-18", timeEstimate: 960, totalTrackedTime: 900, timeEntries: [{ startTime: "2026-09-17T08:00:00", endTime: "2026-09-17T16:00:00" }, { startTime: "2026-09-18T08:00:00", endTime: "2026-09-18T15:00:00" }], projects: ["Kitchen remodel"], contexts: ["home"], tags: ["task", "renovation"], blockedBy: [] },
    { path: "Tasks/Plumbing rough-in.md", title: "Plumbing rough-in", status: "in-progress", priority: "high", due: "2026-09-24", timeEstimate: 1440, totalTrackedTime: 240, timeEntries: [{ startTime: "2026-09-21T08:00:00", endTime: "2026-09-21T12:00:00" }], projects: ["Kitchen remodel"], contexts: ["home"], tags: ["task", "renovation"], blockedBy: ["Demolition"] },
    { path: "Tasks/Electrical rough-in.md", title: "Electrical rough-in", status: "open", priority: "high", due: "2026-09-24", timeEstimate: 960, totalTrackedTime: 0, projects: ["Kitchen remodel"], contexts: ["home"], tags: ["task", "renovation"], blockedBy: ["Demolition"] },
    { path: "Tasks/Drywall.md", title: "Drywall", status: "open", priority: "normal", due: "2026-09-30", timeEstimate: 960, totalTrackedTime: 0, projects: ["Kitchen remodel"], contexts: ["home"], tags: ["task", "renovation"], blockedBy: ["Plumbing rough-in", "Electrical rough-in"] },
    { path: "Tasks/Cabinets and counters.md", title: "Cabinets and counters", status: "open", priority: "normal", due: "2026-10-07", timeEstimate: 1440, totalTrackedTime: 0, projects: ["Kitchen remodel"], contexts: ["home"], tags: ["task", "renovation"], blockedBy: ["Drywall"] },
  ],
  pagination: { total: 11, hasMore: false, limit: 200 },
});

export const DEMO_EVENTS_JSON = JSON.stringify({
  events: [
    { title: "Standup", start: "2026-09-16T09:30:00", end: "2026-09-16T09:45:00", source: "Work" },
    { title: "Deep work: roadmap", start: "2026-09-16T10:00:00", end: "2026-09-16T12:00:00", source: "Personal" },
    { title: "1:1 with mentor", start: "2026-09-17T15:00:00", end: "2026-09-17T15:30:00", source: "Work" },
    { title: "Release review", start: "2026-09-18T14:00:00", end: "2026-09-18T15:00:00", source: "Work" },
  ],
});

export const DEMO_STATS_JSON = JSON.stringify({
  total: 42, completed: 25, active: 15, overdue: 3, archived: 2,
});
