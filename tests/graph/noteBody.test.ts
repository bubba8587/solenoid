// [[B1]] obsidianBet, [[vault-read#The body as data]]
import { describe, it, expect } from "vitest";
import { readTasks, tasksCube, readTables, tablesFrame, readInlineFields, planTaskMark, setTaskMarks } from "../../src/graph/noteBody";
import { resolveKeyOrField, writableKeys } from "../../src/graph/frontmatterPatch";
import { notesToCube, resolveLink, backlinksOf } from "../../src/graph/vaultCube";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";
import { ImportObsidianNode } from "../../src/graph/nodes/obsidian";
import { isCubeValue, isFrameValue } from "../../src/graph/frame";

const day = (iso: string) => parseDateToSerial(iso);
const col = (v: { columns: { name: string }[] } | null, name: string) =>
  (v!.columns.find((c) => c.name === name) as unknown as { cells?: unknown[]; values?: unknown[] });
const cells = (v: { columns: { name: string }[] } | null, name: string) => col(v, name).cells ?? col(v, name).values;

describe("a note's checklist items", () => {
  const body = [
    "# Kitchen",
    "- [ ] Order tiles 📅 2026-09-12 ⏫ #buy",
    "- [x] Measure the room ✅ 2026-09-02",
    "## Floor",
    "* [/] Sand the floor [due:: 2026-09-20] (scheduled:: 2026-09-15)",
    "    1. [-] Rent a sander 🔁 every week 🛫 2026-09-10",
    "> [!todo]",
    "> - [ ] Inside a callout #home/kitchen [priority:: low]",
    "```",
    "- [ ] not a task",
    "```",
    "- a plain item",
    "- [X] Capital x",
  ].join("\n");
  const tasks = readTasks(body, 4);

  it("reads each item's text, mark and place, and nothing from a code fence or a plain item", () => {
    expect(tasks.map((t) => t.task)).toEqual([
      "Order tiles #buy", "Measure the room", "Sand the floor", "Rent a sander", "Inside a callout #home/kitchen", "Capital x",
    ]);
    expect(tasks.map((t) => t.done)).toEqual([false, true, false, false, false, true]);
    expect(tasks.map((t) => t.status)).toEqual([null, null, "/", "-", null, null]);
    expect(tasks.map((t) => t.heading)).toEqual(["Kitchen", "Kitchen", "Floor", "Floor", "Floor", "Floor"]);
    expect(tasks.map((t) => t.line)).toEqual([6, 7, 9, 10, 12, 17]);
  });

  it("reads the Tasks plugin's emoji fields and Dataview's bracketed ones, and takes them out of the text", () => {
    expect(tasks[0]).toMatchObject({ due: day("2026-09-12"), priority: "high", tags: ["buy"] });
    expect(tasks[1].completed).toBe(day("2026-09-02"));
    expect(tasks[2]).toMatchObject({ due: day("2026-09-20"), scheduled: day("2026-09-15") });
    expect(tasks[3]).toMatchObject({ due: null, scheduled: null, completed: null });
    expect(tasks[4]).toMatchObject({ priority: "low", tags: ["home/kitchen"] });
  });

  it("is a nested table with the task's own status, dates, priority and tags named for the task", () => {
    const cube = tasksCube(tasks);
    expect(cube!.columns.map((c) => c.name)).toEqual([
      "task", "done", "taskStatus", "taskDue", "taskScheduled", "taskCompleted", "taskPriority", "taskTags", "heading", "line",
    ]);
    expect(cells(cube, "taskTags")![0]).toEqual(["buy"]);
    expect(tasksCube([])).toBeNull();
  });
});

describe("a note's tables", () => {
  const body = [
    "## Hours",
    "| Day | Hours | Who |",
    "|-----|------:|-----|",
    "| Mon | 3.5 | Ada |",
    "| Tue | 4 | [[People/Sam|Sam]] and `a|b` and x\\|y |",
    "| Wed |",
    "",
    "## Costs",
    "Item | Cost",
    "---|---",
    "Paint | 1,250.50",
    "",
    "not | a table",
    "```",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "```",
  ].join("\n");

  it("reads a header, the dashes under it and the rows, with a pipe inside a link, a code span or an escape kept", () => {
    const tables = readTables(body);
    expect(tables.map((t) => [t.heading, t.headers])).toEqual([["Hours", ["Day", "Hours", "Who"]], ["Costs", ["Item", "Cost"]]]);
    expect(tables[0].rows).toEqual([["Mon", "3.5", "Ada"], ["Tue", "4", "[[People/Sam|Sam]] and `a|b` and x|y"], ["Wed", "", ""]]);
  });

  it("stacks a note's tables into one, typed as an imported file is, each row under its table's heading", () => {
    const frame = tablesFrame(readTables(body));
    expect(frame!.columns.map((c) => [c.name, c.type])).toEqual([
      ["heading", "string"], ["Day", "string"], ["Hours", "number"], ["Who", "string"], ["Item", "string"], ["Cost", "number"],
    ]);
    expect(cells(frame, "heading")).toEqual(["Hours", "Hours", "Hours", "Costs"]);
    expect(cells(frame, "Hours")).toEqual([3.5, 4, null, null]);
    expect(cells(frame, "Cost")).toEqual([null, null, null, 1250.5]);
    expect(tablesFrame([])).toBeNull();
  });

  it("leaves a table's own heading column alone", () => {
    const frame = tablesFrame(readTables("# Top\n| heading | n |\n|---|---|\n| mine | 1 |"));
    expect(frame!.columns.map((c) => c.name)).toEqual(["heading", "n"]);
    expect(cells(frame, "heading")).toEqual(["mine"]);
  });
});

describe("a note's inline fields", () => {
  const body = [
    "Owner:: Ada",
    "- **Budget**:: 1200",
    "Started:: 2026-09-01",
    "Reviewed:: true",
    "Quoted:: \"12\"",
    "Empty::",
    "A sentence with (mood:: good) and [effort:: 3] inside.",
    "Owner:: Sam",
    "- [ ] a task's [due:: 2026-09-20] is the task's",
    "`Key:: in code` and std::vector are not fields.",
    "```",
    "Fenced:: no",
    "```",
  ].join("\n");

  it("reads a line's key and value, a bracketed pair anywhere, and each value as its kind", () => {
    const fields = Object.fromEntries(readInlineFields(body).map((f) => [f.key, f.value]));
    expect(fields).toEqual({
      Owner: ["Ada", "Sam"], Budget: 1200, Started: day("2026-09-01"), Reviewed: true, Quoted: "12", mood: "good", effort: 3,
    });
    expect(readInlineFields(body).find((f) => f.key === "Started")?.guessed).toBe("date");
  });
});

describe("Vault Folder reads the body as data when asked", () => {
  const notes = [
    { path: "Log/Week 1.md", text: "---\nOwner: Front\nstatus: open\n---\nOwner:: Inline\nBudget:: 1200\n\n| Day | Hours |\n|---|---|\n| Mon | 2 |\n\n- [ ] Order tiles 📅 2026-09-12\n" },
    { path: "Log/Week 2.md", text: "Budget:: 300\nJust prose.\n" },
  ];
  const sources = { mdbaseFor: () => ({}), obsidian: {} };

  it("adds nothing unless asked", () => {
    const names = notesToCube(notes, sources).columns.map((c) => c.name);
    expect(names).not.toContain("note-tasks");
    expect(names).not.toContain("note-tables");
    expect(names).not.toContain("Budget");
  });

  it("adds note-tasks and note-tables after the file columns, blank for a note with none, and a column per inline field", () => {
    const cube = notesToCube(notes, sources, { includeTasks: true, includeTables: true, includeFields: true });
    const names = cube.columns.map((c) => c.name);
    expect(names.slice(11)).toEqual(["note-tasks", "note-tables", "Owner", "status", "Budget"]);
    expect(cells(cube, "note-tasks")![1]).toBeNull();
    expect(cells(cube, "note-tables")![1]).toBeNull();
    const tasks = cells(cube, "note-tasks")![0] as { columns: { name: string }[] };
    expect(cells(tasks, "task")).toEqual(["Order tiles"]);
    expect(cells(tasks, "line")).toEqual([12]);
    expect(cells(cells(cube, "note-tables")![0] as { columns: { name: string }[] }, "Hours")).toEqual([2]);
    expect(cells(cube, "Budget")).toEqual([1200, 300]);
    expect(col(cube, "Budget")).toMatchObject({ type: "number" });
  });

  it("keeps the frontmatter's value for a key written both ways", () => {
    const cube = notesToCube(notes, sources, { includeFields: true });
    expect(cells(cube, "Owner")).toEqual(["Front", null]);
  });
});

describe("the notes that link to a note", () => {
  const vault = [
    { path: "Projects/Kitchen.md", text: "See [[Sam]] and [[People/Ada|Ada]]. Itself: [[Kitchen]]." },
    { path: "People/Sam.md", text: "Leads [[Projects/Kitchen]] and [[Kitchen#Budget]]. ![[Chart.png]]" },
    { path: "People/Ada.md", text: "---\nproject: \"[[kitchen]]\"\n---\nNo one named [[Nobody]]." },
    { path: "Archive/People/Sam.md", text: "An older Sam, linking [[Archive/People/Sam]] and [[Projects/Kitchen.md]]." },
  ];
  const paths = vault.map((n) => n.path);

  it("resolves a link by its path, else by its name, the note nearest the vault root first, whatever the case", () => {
    expect(resolveLink("Projects/Kitchen", paths)).toBe("Projects/Kitchen.md");
    expect(resolveLink("kitchen", paths)).toBe("Projects/Kitchen.md");
    expect(resolveLink("Kitchen.md", paths)).toBe("Projects/Kitchen.md");
    expect(resolveLink("Sam", paths)).toBe("People/Sam.md");
    expect(resolveLink("Archive/People/Sam", paths)).toBe("Archive/People/Sam.md");
    expect(resolveLink("Nobody", paths)).toBeNull();
  });

  it("lists each note's linkers once, in path order, from frontmatter and body alike, never the note itself", () => {
    const back = backlinksOf(["Projects/Kitchen.md", "People/Sam.md", "People/Ada.md"], vault);
    expect(back.get("Projects/Kitchen.md")).toEqual(["Archive/People/Sam.md", "People/Ada.md", "People/Sam.md"]);
    expect(back.get("People/Sam.md")).toEqual(["Projects/Kitchen.md"]);
    expect(back.get("People/Ada.md")).toEqual(["Projects/Kitchen.md"]);
  });

  it("is a backlinks column on the Cube when the vault's notes are given, and absent otherwise", () => {
    const sources = { mdbaseFor: () => ({}), obsidian: {} };
    const folder = vault.filter((n) => n.path.startsWith("People/"));
    expect(notesToCube(folder, sources).columns.map((c) => c.name)).not.toContain("backlinks");
    const cube = notesToCube(folder, sources, { backlinksFrom: vault });
    expect(cells(cube, "backlinks")).toEqual([["Projects/Kitchen.md"], ["Projects/Kitchen.md"]]);
  });
});

describe("Import Obsidian Note gives one note's tasks and tables as outputs", () => {
  const body = "---\nstatus: open\n---\n# Week\n\n| Day | Hours |\n|---|---|\n| Mon | 2 |\n\n- [ ] Order tiles\n- [x] Measure\n";

  it("mints note-tasks and note-tables beside the frontmatter's outputs when the note has them", () => {
    const n = new ImportObsidianNode({ body });
    n.syncFields();
    expect(Object.keys(n.outputs).sort()).toEqual(["document", "note-tables", "note-tasks", "path", "status"]);
    const out = n.fieldValues();
    expect(isCubeValue(out["note-tasks"])).toBe(true);
    expect(isFrameValue(out["note-tables"])).toBe(true);
    expect(cells(out["note-tasks"] as never, "task")).toEqual(["Order tiles", "Measure"]);
    expect(cells(out["note-tasks"] as never, "line")).toEqual([10, 11]);
    expect(cells(out["note-tables"] as never, "Hours")).toEqual([2]);
  });

  it("mints neither for a note with no checklist and no table, and drops them when they leave the note", () => {
    const n = new ImportObsidianNode({ body });
    n.syncFields();
    n.body = "---\nstatus: open\n---\nJust prose.\n";
    expect(n.syncFields().removed).toEqual(["note-tasks", "note-tables"]);
    expect(Object.keys(n.outputs).sort()).toEqual(["document", "path", "status"]);
  });

  it("leaves a frontmatter key of the same name as the output", () => {
    const n = new ImportObsidianNode({ body: "---\nnote-tasks: mine\n---\n- [ ] one\n" });
    n.syncFields();
    expect(n.fieldValues()["note-tasks"]).toBe("mine");
  });
});

describe("ticking a checklist item changes one character of the note", () => {
  const note = [
    "---", "status: open", "---",
    "- [ ] Order tiles 📅 2026-09-12",
    "- [x] Measure the room",
    "> - [/] Sand the floor",
    "Just prose",
    "```", "- [ ] in a fence", "```",
    "    * [X] Indented, capital x\r",
  ].join("\n");

  it("done makes the mark an x, not done clears an x, and any other mark is left as it is", () => {
    expect(planTaskMark(note, { line: 4, done: true })).toEqual({ action: "update", before: "[ ]", after: "[x]" });
    expect(planTaskMark(note, { line: 4, done: false })).toMatchObject({ action: "unchanged" });
    expect(planTaskMark(note, { line: 5, done: false })).toEqual({ action: "update", before: "[x]", after: "[ ]" });
    expect(planTaskMark(note, { line: 5, done: true })).toMatchObject({ action: "unchanged" });
    expect(planTaskMark(note, { line: 6, done: false })).toMatchObject({ action: "unchanged", before: "[/]", after: "[/]" });
    expect(planTaskMark(note, { line: 6, done: true })).toMatchObject({ action: "update", after: "[x]" });
    expect(planTaskMark(note, { line: 11, done: true })).toMatchObject({ action: "unchanged", before: "[X]" });
  });

  it("refuses a line that is no checklist item, one in a code fence, one past the end, and an item that is no longer the one read", () => {
    for (const line of [7, 9, 99]) {
      expect(planTaskMark(note, { line, done: true })).toMatchObject({ action: "refused", reason: `line ${line} is not a checklist item` });
    }
    expect(planTaskMark(note, { line: 4, done: true, task: "Order tiles" })).toMatchObject({ action: "update" });
    expect(planTaskMark(note, { line: 4, done: true, task: "Order paint" })).toMatchObject({ action: "refused", reason: "the item at line 4 has changed" });
  });

  it("writes back the same note with only the marks changed, line endings and all", () => {
    const out = setTaskMarks(note, [{ line: 4, done: true }, { line: 5, done: false }, { line: 7, done: true }, { line: 11, done: false }, { line: 6, done: false }]);
    const want = note.replace("- [ ] Order tiles", "- [x] Order tiles").replace("- [x] Measure", "- [ ] Measure").replace("* [X] Indented", "* [ ] Indented");
    expect(out).toBe(want);
    expect(setTaskMarks(note, [{ line: 4, done: false }])).toBe(note);
  });

  it("what it wrote reads back as the tasks it set", () => {
    const body = "- [ ] one\n- [ ] two\n";
    const tasks = readTasks(setTaskMarks(body, [{ line: 2, done: true, task: "two" }]));
    expect(tasks.map((t) => t.done)).toEqual([false, true]);
  });
});

describe("a property write never copies the body's data into the frontmatter", () => {
  it("leaves out the columns Vault Folder read from the body and the vault's links", () => {
    const cube = notesToCube(
      [{ path: "a.md", text: "---\nstatus: open\n---\n- [ ] one\n\n| x |\n|---|\n| 1 |\n" }],
      { mdbaseFor: () => ({}), obsidian: {} },
      { includeTasks: true, includeTables: true, backlinksFrom: [] },
    );
    expect(writableKeys(cube, "")).toEqual(["tags", "status"]);
  });

  it("a key the note holds as an inline field is no change when it is the same and refused when it differs", () => {
    const text = "---\nstatus: open\n---\nOwner:: Ada\nBudget:: 1200\n";
    expect(resolveKeyOrField(text, "Owner", "Ada")).toMatchObject({ action: "unchanged", before: "Ada" });
    expect(resolveKeyOrField(text, "Budget", 1200)).toMatchObject({ action: "unchanged" });
    expect(resolveKeyOrField(text, "Owner", "Sam")).toMatchObject({ action: "refused", before: "Ada" });
    expect(resolveKeyOrField(text, "status", "closed")).toMatchObject({ action: "update" });
    expect(resolveKeyOrField(text, "fresh", "new")).toMatchObject({ action: "add" });
  });
});
