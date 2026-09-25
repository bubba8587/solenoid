// [[B3]] sameNodeEverywhere, [[C107]] obsidianPlugin
// The plugin cut: a short video for Obsidian users. Figures from an email go into a Frame property through the
// plugin's Form view; Solenoid joins them to a roster note, totals them with PIVOTBY and charts them; the chart is
// written back into the note. `app: "split"` scenes film Obsidian and Solenoid side by side on one display.
import fs from "node:fs";
import path from "node:path";
import { VAULT, noteOnly } from "./obsidian.mjs";
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

/** Scrolls a reading-view pane (0 is the left one) so the element matching sel (and text) sits `at` of the way down. */
async function scrollTo(c, sel, text, at = 0.3, pane = 0) {
  await c.obs((s, t, f, i) => {
    const leaf = window.app.workspace.getLeavesOfType("markdown")[i];
    const el = leaf.view.containerEl.querySelector(".markdown-preview-view");
    const target = [...el.querySelectorAll(s)].find((e) => t === undefined || e.textContent.trim() === t);
    if (target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * f;
  }, sel, text, at, pane);
  await c.sleep(300);
}

/** The task checkbox whose line reads `text`, in the rightmost pane that shows it. */
const task = (c, text) => c.obs((t) => {
  const items = [...document.querySelectorAll(".markdown-preview-view li.task-list-item")].filter((l) => l.textContent.trim().startsWith(t));
  const boxes = items.map((l) => l.querySelector("input.task-list-item-checkbox")?.getBoundingClientRect()).filter((r) => r && r.width > 0);
  const r = boxes.sort((a, b) => b.x - a.x)[0];
  return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, text);

/** The note in Obsidian, reading view, the plugin's look on and nothing but the note. With `panes: 2` the note opens
 *  again beside itself, scrolled to Priya's table, so the table stays in view while the popup covers the first pane. */
async function noteView(o, { zoom = 1, panes = 1 } = {}) {
  await closeOtherWindows(o);
  await noteOnly(o.page);
  await obsZoom(o, zoom);
  await look(o);
  await o.obs(() => { for (const leaf of window.app.workspace.getLeavesOfType("markdown").slice(1)) leaf.detach(); });
  await openNote(o, NOTE, { reading: true });
  if (panes === 2) {
    await o.obs(async (f) => {
      const ws = window.app.workspace, left = ws.getLeavesOfType("markdown")[0];
      const right = ws.getLeaf("split", "vertical");
      await right.openFile(ws.app.vault.getAbstractFileByPath(f), { state: { mode: "preview" } });
      await right.rebuildView();
      ws.setActiveLeaf(left, { focus: false });
      document.activeElement?.blur?.();
    }, NOTE);
    await o.sleep(900);
    await scrollTo(o, "p", undefined, 0.16, 1);
  }
}

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

  "pl-note": {
    app: "obsidian",
    caption: ["Solenoid Properties", "The plugin adds frames, cubes, lists and matrices to Obsidian's property types. The note underneath stays plain YAML."],
    async setup(c) {
      await noteView(c, { zoom: 1.1, panes: 2 });
      await c.hand.show(640, 560);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(900);
      const table = (await rectsIn(page, ".markdown-preview-view table")).sort((a, b) => b.x - a.x)[0];
      await hand.move(table.x + table.w * 0.62, table.y + table.h * 0.6, { ms: 1100 });
      await c.box(table, 6);
      await sleep(1500);
      const chip = await need(page, '.metadata-property[data-property-key="q3"] .solenoid-property-chip');
      await hand.move(chip.cx + 40, chip.cy + 16, { ms: 1100 });
      await c.box(await need(page, '.metadata-property[data-property-key="q3"]'), 4);
      await sleep(2000);
      await c.clearBoxes();
    },
  },

  "pl-form": {
    app: "obsidian",
    caption: ["Solenoid's table editor", "Each chip opens the editor Solenoid uses: a grid, a form for one record at a time, or CSV. Columns keep their types."],
    async setup(c) {
      await noteView(c, { zoom: 1.1, panes: 2 });
      const chip = await need(c.page, '.metadata-property[data-property-key="q3"] .solenoid-property-chip');
      await c.hand.show(chip.cx + 40, chip.cy + 16);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(600);
      await hand.click(await need(page, '.metadata-property[data-property-key="q3"] .solenoid-property-chip'));
      await sleep(900);
      await hand.click(await need(page, "button", "Form"));
      await sleep(600);
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
      await sleep(700);
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
    app: "obsidian",
    caption: ["The Solenoid look", "Turn on the plugin's theme and the whole vault takes Solenoid's palette, with the accent you pick."],
    panels: ["obs"],
    hold: 1.9,
    states: [
      { palette: "Default", accent: "gold", mode: "dark" },
      { palette: "Blueprint", accent: "blue", mode: "dark" },
      { palette: "Orchard", accent: "teal", mode: "dark" },
      { palette: "Solarized", accent: "gold", mode: "light" },
    ],
    async setup(c) {
      await noteView(c, { zoom: 1.3 });
      await c.hand.hide();
    },
    async apply(c, state) { await look(c, state); },
    async teardown(c) { await look(c); },
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
