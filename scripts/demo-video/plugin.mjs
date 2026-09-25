// [[B3]] sameNodeEverywhere, [[C107]] obsidianPlugin
// The plugin cut: a short video for Obsidian users. A meeting's attendees go into a String List property; figures from
// an email go into a Frame property through the plugin's Form view; Solenoid joins them to a roster note, totals them
// with PIVOTBY and charts them; the chart is written back into the note. `app: "split"` scenes film Obsidian and
// Solenoid side by side on one display.
import fs from "node:fs";
import path from "node:path";
import { VAULT, noteOnly, placeWindow, OBS_LEFT } from "./obsidian.mjs";
import { ROOT } from "./rig.mjs";
import { rectIn, need, openNote, closeOtherWindows } from "./roundtrip.mjs";

export const NOTE = "Sales/Q3 review.md";
export const ROSTER = "Sales/Divisions.md";
export const DOC = "Q3 by region";
// The West rows from the email in the note, field by field as the Form view takes them.
const WEST = [
  ["Seattle", "472000", "1180", "64", "21"], ["Portland", "251000", "628", "35", "8"],
  ["San Francisco", "598000", "1495", "81", "27"], ["Los Angeles", "655000", "1638", "88", "30"],
];
const CHAIN = ["Divisions", "Q3 review", "Join", "PIVOTBY", "Q3 by region", "Regional chart"];
// The meeting's notes and who was in it.
const NOTES = ["Central is under target; Omar follows up.", "West figures came in from Priya."];
const ATTENDEES = ["Sam", "Ada", "Priya", "Omar"];

const wire = (source, sourceOutput, target, targetInput) => ({ source, sourceOutput, target, targetInput });
const shipped = (rel) => fs.readFileSync(path.join(ROOT, "demo-vault", rel), "utf8");

/** The regional graph, two rows that read left to right: the notes, Join and PIVOTBY on top; the chart, its report and
 *  the writer below. Conduits turned 180° carry PIVOTBY back to the start of the second row, so no cable winds back
 *  across the cards. The Q3 card starts from the note as shipped, with no West rows, until a refresh reads it. */
export function salesGraph() {
  return {
    v: 2,
    nodes: [
      { id: "roster", type: "ImportObsidianNode", x: 0, y: 0, init: { label: "Divisions", fileName: ROSTER, body: shipped(ROSTER), height: 150 } },
      { id: "q3", type: "ImportObsidianNode", x: 0, y: 180, init: { label: "Q3 review", fileName: NOTE, body: shipped(NOTE), height: 150 } },
      { id: "join", type: "JoinNode", x: 420, y: 0, init: { label: "Join", how: "left" }, stringLiterals: { leftKey: "Division", rightKey: "" } },
      { id: "pivot", type: "PivotNode", x: 700, y: 40, init: { label: "PIVOTBY", agg: "sum" }, stringLiterals: { rowFields: "Region", colFields: "", values: "Sales, Target" } },
      // Two Conduits turned 180°: a U-turn under PIVOTBY, a straight run back left between the rows, a hook into the chart.
      { id: "turn", type: "ConduitNode", x: 890, y: 392, init: { angle: 180, seq: 1 } },
      { id: "back", type: "ConduitNode", x: 20, y: 392, init: { angle: 180, seq: 2 } },
      { id: "chart", type: "ChartNode", x: 80, y: 440, init: { label: "Q3 by region", op: "column" } },
      { id: "report", type: "ReportNode", x: 430, y: 470, init: { label: "Chart for the note", body: "{{ chart }}\n" } },
      { id: "write", type: "WriteObsidianNode", x: 700, y: 470, init: { label: "Regional chart", subfolder: "Sales", mode: "block" }, stringLiterals: { path: "Q3 review", keys: "" } },
    ],
    connections: [
      wire("roster", "roster", "join", "left"), wire("q3", "q3", "join", "right"),
      wire("join", "frame", "pivot", "frame"),
      wire("pivot", "frame", "turn", "in_0"), wire("turn", "out_0", "back", "in_0"), wire("back", "out_0", "chart", "values"),
      wire("chart", "chart", "report", "chart"), wire("report", "document", "write", "in"),
    ],
  };
}

/** Every visible match of sel in the page or its shadow roots, in document order. */
function rectsIn(page, sel) {
  return page.evaluate((s) => {
    const roots = [document, ...[...document.querySelectorAll("*")].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
    const out = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push({ x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 });
      }
    }
    return out;
  }, sel);
}

/** Obsidian's whole-UI zoom, as Ctrl + = sets it: larger for a full-screen shot, 1 beside Solenoid. */
const obsZoom = (c, f) => c.obs((z) => (window.electron?.webFrame ?? window.require("electron").webFrame).setZoomFactor(z), f);

/** The plugin's look in a palette, accent and theme. */
async function look(c, { palette = "Default", accent = "gold", mode = "dark" } = {}) {
  await c.obs(async (p, a, m) => {
    const app = window.app, pl = app.plugins.plugins["solenoid-properties"];
    app.changeTheme(m === "light" ? "moonstone" : "obsidian");
    await pl.setLook(true);
    await pl.setPalette(p);
    await pl.setAccent(a);
  }, palette, accent, mode);
}

/** The app's palette, accent and theme. Fired on a timer: awaited across the protocol, a palette swap loses the call. */
async function appLook(s, { palette = "Default", accent = "gold", mode = "dark" } = {}) {
  await s.demo((p, a, m) => {
    setTimeout(async () => {
      (await import("/src/graph/palette.ts")).paletteStore.setActiveBase(p);
      const { appThemeStore } = await import("/src/graph/appTheme.ts");
      appThemeStore.setAccent(a);
      appThemeStore.setMode(m);
    }, 0);
  }, palette, accent, mode);
}

/** Scrolls the reading view so the element matching sel (and text) sits `at` of the way down the pane. */
async function scrollTo(c, sel, text, at = 0.3) {
  await c.obs((s, t, f) => {
    const leaf = window.app.workspace.getLeavesOfType("markdown")[0];
    const el = leaf.view.containerEl.querySelector(".markdown-preview-view");
    const target = [...el.querySelectorAll(s)].find((e) => t === undefined || e.textContent.trim() === t);
    if (target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * f;
  }, sel, text, at);
  await c.sleep(300);
}

/** The reading view's task checkbox whose line reads `text`. */
const task = (c, text) => c.obs((t) => {
  const li = [...document.querySelectorAll(".markdown-preview-view li.task-list-item")].find((l) => l.textContent.trim().startsWith(t));
  const r = li?.querySelector("input.task-list-item-checkbox")?.getBoundingClientRect();
  return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, text);

/** The note in Obsidian with the plugin's look on and nothing but the note: reading view, or live preview to type. */
async function noteView(o, { zoom = 1, reading = true } = {}) {
  await closeOtherWindows(o);
  await noteOnly(o.page);
  await obsZoom(o, zoom);
  await look(o);
  await o.obs(() => { for (const leaf of window.app.workspace.getLeavesOfType("markdown").slice(1)) leaf.detach(); });
  await openNote(o, NOTE, { reading });
}

/** The live-preview line that holds `text` (a bullet's marker renders into the line too). */
const editorLine = (c, text) => c.obs((t) => {
  const line = [...document.querySelectorAll(".markdown-source-view .cm-line")].find((l) => l.textContent.includes(t));
  const r = line?.getBoundingClientRect();
  return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, text);

/** The regional graph in the Solenoid window, loaded unless it already is. */
async function graphView(s) {
  await s.legend(false);
  if ((await s.currentDoc()) !== DOC) await s.doc(salesGraph(), DOC);
}

export const PLUGIN = {
  "pl-intro": {
    app: "split",
    fresh: true,
    async setup(c) {
      await noteView(c.obs);
      await graphView(c.sol);
      await c.sol.frame(CHAIN, { pad: 0.05, maxK: 1.1, dy: 20 });
    },
    async act(c) { await c.sleep(5200); },
  },

  "pl-meeting": {
    app: "obsidian",
    caption: ["Solenoid Properties", "The plugin adds frames, cubes, lists and matrices to Obsidian's property types. The note underneath stays plain YAML."],
    async setup(c) {
      await noteView(c, { zoom: 1.12, reading: false });
      await c.hand.show(820, 430);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(700);
      // Two lines of meeting notes under the first, typed at twice the speed in compose.mjs.
      const first = await editorLine(c, "Q3 closes Friday.");
      await hand.click({ x: first.x + first.w - 40, y: first.cy });
      await sleep(200);
      c.rec.at("fast", { rate: 2 });
      for (const line of NOTES) {
        await hand.press("Enter");
        await sleep(120);
        await hand.type(line, { cps: 15 });
        await sleep(150);
      }
      c.rec.at("unfast");
      await sleep(500);
      // Who was there, as a String List property.
      await hand.click(await need(page, ".metadata-add-button"));
      await sleep(300);
      await hand.type("attendees", { cps: 11 });
      await sleep(200);
      await hand.press("Enter");
      await sleep(350);
      await hand.click(await need(page, '.metadata-property[data-property-key="attendees"] .metadata-property-icon'));
      await sleep(350);
      const type = await need(page, ".menu .menu-item", "Property type");
      await hand.move(type.cx, type.cy, { ms: 400 });
      await sleep(600);
      const list = await need(page, ".menu .menu-item", "String List");
      await hand.move(list.x + 20, type.cy, { ms: 300, bow: 0 });
      await hand.move(list.cx, list.cy, { ms: 600 });
      await sleep(250);
      await hand.click();
      await sleep(600);
      await hand.click(await need(page, '.metadata-property[data-property-key="attendees"] .solenoid-property-chip'));
      await sleep(800);
      for (let i = 1; i < ATTENDEES.length; i++) {
        await hand.click(await need(page, "button", "Add Row"));
        await sleep(180);
      }
      const cells = await rectsIn(page, "td.table-popup__cell");
      await hand.click(cells[0]);
      await sleep(120);
      for (const [i, name] of ATTENDEES.entries()) {
        if (i) { await hand.press("Enter"); await sleep(120); }
        await hand.type(name, { cps: 12 });
        await sleep(150);
      }
      await sleep(400);
      await hand.click(await need(page, "button", "Save"));
      await sleep(600);
      await c.box(await need(page, '.metadata-property[data-property-key="attendees"]'), 4);
      await sleep(1600);
      await c.clearBoxes();
    },
  },

  "pl-form": {
    app: "obsidian",
    caption: ["Solenoid's table editor", "Each chip opens the editor Solenoid uses: a grid, a form for one record at a time, or CSV. Columns keep their types."],
    async setup(c) {
      await noteView(c, { zoom: 1.12 });
      // The properties at the top, so Priya's table sits clear of the caption.
      await scrollTo(c, ".metadata-container", undefined, 0.03);
      await c.hand.show(820, 430);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(700);
      // Priya's table, then the Frame property it goes into.
      const table = await need(page, ".markdown-preview-view table");
      await hand.move(table.x + table.w * 0.62, table.y + table.h * 0.6, { ms: 1000 });
      await c.box(table, 6);
      await sleep(1300);
      await c.clearBoxes();
      await hand.click(await need(page, '.metadata-property[data-property-key="q3"] .solenoid-property-chip'));
      await sleep(1000);
      // The grid: its typed columns, down the Sales column and across a row.
      const heads = await rectsIn(page, ".table-popup__colhead");
      const cells = await rectsIn(page, "td.table-popup__cell");
      await hand.move(heads[1].cx, heads[1].cy, { ms: 700 });
      await sleep(450);
      await hand.move(cells[4 * 5 + 1].cx, cells[4 * 5 + 1].cy, { ms: 800 });
      await sleep(300);
      await hand.move(cells[4 * 5 + 4].cx, cells[4 * 5 + 4].cy, { ms: 900 });
      await sleep(700);
      // The same rows as CSV.
      await hand.click(await need(page, "button", "CSV"));
      await sleep(700);
      const csv = await need(page, "textarea");
      await hand.move(csv.x + csv.w * 0.35, csv.y + csv.h * 0.55, { ms: 800 });
      await sleep(1400);
      // The caption waits for the Form view: the grid's own buttons sit where it would.
      c.rec.at("caption");
      await hand.click(await need(page, "button", "Form"));
      await sleep(900);
      // The first record at typing speed, the other three fast-forwarded in compose.mjs.
      for (const [i, fields] of WEST.entries()) {
        if (i === 1) c.rec.at("fast", { rate: 4 });
        await hand.click(await need(page, "button", "Add Record"));
        await sleep(250);
        const boxes = await rectsIn(page, ".table-popup__form-box-input");
        for (const [j, text] of fields.entries()) {
          await hand.click({ x: boxes[j].x + 30, y: boxes[j].cy });
          await sleep(100);
          await hand.type(text, { cps: 15 });
          await sleep(120);
        }
        await sleep(150);
      }
      c.rec.at("unfast");
      await sleep(350);
      await hand.click(await need(page, "button", "Save"));
      await sleep(900);
      await hand.click(await task(c, "Add the West figures"));
      await sleep(1500);
    },
  },

  "pl-reload": {
    app: "split",
    // Solenoid enters here: compose.mjs opens the scene on its first frame, blurred under the Solenoid wordmark.
    chapter: { eyebrow: "Opening" },
    caption: ["Join and PIVOTBY", "Join matches each division to its region and target in a second note. PIVOTBY, Excel's own function, totals both by region."],
    async setup(c) {
      await noteView(c.obs);
      await graphView(c.sol);
      await c.sol.frame(CHAIN, { pad: 0.05, maxK: 1.1, dy: 20 });
      const box = await task(c.obs, "Add the West figures");
      await c.hand("obs", { x: box.cx + 150, y: box.cy + 30 });
    },
    async act(c) {
      const { sleep } = c, s = c.sol;
      await sleep(1100);
      const data = await s.find(".solenoid-menubar__top", "Data");
      let hand = await c.hand("sol", data);
      await hand.click(data);
      await sleep(500);
      // Straight down into the menu: brushing the next top item on the way opens its menu instead.
      const refresh = await s.find(".solenoid-menubar__option", "Refresh all connections");
      await hand.move(data.cx, refresh.cy, { bow: 0 });
      await hand.click({ x: data.cx + 14, y: refresh.cy });
      await sleep(1300);
      await s.box(await s.socketRow("Q3 review", "q3", "out"), 4);
      await sleep(900);
      await s.box("Q3 by region", 6);
      const chart = await s.node("Q3 by region");
      await hand.move(chart.x + chart.w * 0.5, chart.y + chart.h + 40, { ms: 900 });
      await sleep(2400);
      await s.clearBoxes();
      await sleep(300);
      hand = await c.hand("obs", await task(c.obs, "Reload the regional chart"));
      await hand.click(await task(c.obs, "Reload the regional chart"));
      await sleep(1200);
    },
  },

  "pl-write": {
    app: "split",
    caption: ["Back into the note", "Write to Obsidian replaces one marked block and leaves the rest of the note alone. The chart is saved in the vault as an image."],
    async setup(c) {
      await noteView(c.obs);
      await scrollTo(c.obs, "h2", "By region", 0.28);
      await graphView(c.sol);
      await c.sol.frame(["Q3 by region", "Chart for the note", "Regional chart"], { pad: 0.05, maxK: 1.1, dy: 10 });
      const run = await c.sol.within("Regional chart", "button.sol-write__run", "Run");
      await c.hand("sol", { x: run.cx - 120, y: run.cy + 90 });
    },
    async act(c) {
      const { sleep } = c, s = c.sol;
      const hand = await c.hand("sol");
      await sleep(800);
      const armed = await s.demo(async () => {
        const n = await window.__demo.byLabel("Regional chart");
        const el = (await window.__demo.view()).nodeElement(n.id);
        const box = [...el.querySelectorAll("label.sol-write__armed")].find((l) => l.textContent.trim() === "Armed").querySelector("input");
        const r = box.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      });
      await hand.click(armed);
      await sleep(400);
      await hand.click(await s.within("Regional chart", "button.sol-write__run", "Run"));
      await sleep(2200);
      const img = await rectIn(c.obs.page, ".markdown-preview-view img");
      if (img) await c.obs.box(img, 6);
      await sleep(1800);
      await c.obs.clearBoxes();
      const done = await task(c.obs, "Write the chart back here");
      if (done) {
        const h = await c.hand("obs", done);
        await h.click(done);
      }
      await sleep(1500);
    },
  },

  "pl-look": {
    app: "split",
    caption: ["The Solenoid look", "The plugin's theme gives the whole vault Solenoid's palette and the accent you pick, the same ones the app offers."],
    panels: ["obs"],
    hold: 1.7,
    // Obsidian alone, then beside Solenoid wearing the same palette, accent and theme.
    states: [
      { palette: "Default", accent: "gold", mode: "dark", layout: "full" },
      { palette: "Default", accent: "violet", mode: "dark", layout: "split" },
      { palette: "Orchard", accent: "pink", mode: "dark", layout: "full" },
      { palette: "Blueprint", accent: "sky", mode: "dark", layout: "split" },
      { palette: "Solarized", accent: "vermilion", mode: "light", layout: "split" },
      { palette: "Default", accent: "teal", mode: "light", layout: "full" },
    ],
    async setup(c) {
      await noteView(c.obs);
      await graphView(c.sol);
      await c.sol.frame(CHAIN, { pad: 0.05, maxK: 1.1, dy: 20 });
    },
    async apply(c, state) {
      const full = state.layout === "full";
      await placeWindow(c.obs.page, full ? { top: true } : OBS_LEFT);
      await obsZoom(c.obs, full ? 1.12 : 1);
      await look(c.obs, state);
      await appLook(c.sol, state);
      await c.sleep(500);
      await scrollTo(c.obs, ".metadata-container", undefined, 0.03);
    },
    async teardown(c) {
      await look(c.obs);
      await appLook(c.sol);
      await obsZoom(c.obs, 1);
      await placeWindow(c.obs.page, OBS_LEFT);
    },
  },

  "pl-outro": {
    app: "split",
    async setup(c) {
      await noteView(c.obs);
      await scrollTo(c.obs, "h2", "By region", 0.2);
      await graphView(c.sol);
      await c.sol.frame(CHAIN, { pad: 0.05, maxK: 1.1, dy: 20 });
    },
    async act(c) { await c.sleep(6200); },
  },
};
