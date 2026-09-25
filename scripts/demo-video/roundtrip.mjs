// [[B3]] sameNodeEverywhere, [[C107]] obsidianPlugin
// The Obsidian round trip: the plugin's look, a Frame property, Import Obsidian Note, a Report written back, the note
// opened in Obsidian. `app: "obsidian"` scenes run on obsidian.mjs's rig; the others reach the vault through bridgeVault.
import fs from "node:fs";
import path from "node:path";
import { VAULT } from "./obsidian.mjs";
import { ROOT, VIEW } from "./rig.mjs";

const NOTE = "Projects/Kitchen remodel.md";
const REPORT = "Projects/Kitchen remodel costs.md";
const DOC = "Kitchen costs";
const COSTS_CSV = path.join(ROOT, "scripts", "demo-video", "data", "kitchen-costs.csv");

const wire = (source, sourceOutput, target, targetInput) => ({ source, sourceOutput, target, targetInput });
const money = (id, host, key) => ({
  id, type: "FormatControllerNode", x: 0, y: 0,
  init: { label: "Format", hostNodeId: host, socketKey: key, side: "output", unit: "usd", socketDataType: "number", format: "decimal", decimalDigits: 0, decimalMode: "places" },
});

/** The costs graph over the note as Obsidian saved it; `wired` adds the cable the import scene draws on camera. */
function costsGraph(wired) {
  const body = fs.readFileSync(path.join(VAULT, NOTE), "utf8");
  if (!/^costs:/m.test(body)) throw new Error(`${NOTE} has no costs property yet: record obs-property first`);
  return {
    v: 2,
    nodes: [
      { id: "note", type: "ImportObsidianNode", x: 0, y: 0, init: { label: "Kitchen remodel", fileName: NOTE, body, height: 330 } },
      { id: "group", type: "GroupByFrameNode", x: 560, y: -30, init: { label: "GROUPBY", agg: "sum" }, stringLiterals: { keys: "Category", column: "Amount" } },
      { id: "sort", type: "SortFrameNode", x: 830, y: -30, init: { label: "Biggest first", dir: "desc" }, stringLiterals: { column: "Amount" } },
      { id: "chart", type: "ChartNode", x: 1100, y: -30, init: { label: "Costs by category", op: "bar" } },
      { id: "paid", type: "SumIfsNode", x: 560, y: 760, init: { label: "Paid", op: "sumifs", condConfig: { 0: { op: "eq" } }, valueKeys: ["column0", "value0"] }, stringLiterals: { values: "Amount", column0: "Paid", value0: "TRUE" } },
      { id: "owed", type: "SumIfsNode", x: 830, y: 760, init: { label: "Still to pay", op: "sumifs", condConfig: { 0: { op: "eq" } }, valueKeys: ["column0", "value0"] }, stringLiterals: { values: "Amount", column0: "Paid", value0: "FALSE" } },
      { id: "left", type: "ExpressionNode", x: 1100, y: 760, init: { label: "To spare", expr: "budget - paid - owed" } },
      money("budgetFc", "note", "budget"), money("paidFc", "paid", "result"), money("owedFc", "owed", "result"), money("leftFc", "left", "result"),
      {
        id: "report", type: "ReportNode", x: 1440, y: 40,
        init: { label: "Cost report", body: "# Kitchen remodel costs\n\nOf the **{{ budget }}** budget, **{{ paid }}** is paid and **{{ owed }}** is still to pay, which leaves **{{ left }}**.\n\n{{ chart }}\n\n{{ byCategory }}\n" },
      },
      { id: "write", type: "WriteObsidianNode", x: 1760, y: 40, init: { label: "Write to Obsidian", subfolder: "Projects" }, stringLiterals: { path: "Kitchen remodel costs", keys: "" } },
    ],
    connections: [
      ...(wired ? [wire("note", "costs", "group", "frame")] : []),
      wire("group", "frame", "sort", "frame"), wire("sort", "frame", "chart", "values"),
      wire("note", "costs", "paid", "frame"), wire("note", "costs", "owed", "frame"),
      wire("note", "budget", "left", "budget"), wire("paid", "result", "left", "paid"), wire("owed", "result", "left", "owed"),
      wire("note", "budget", "budgetFc", "in"), wire("paid", "result", "paidFc", "in"), wire("owed", "result", "owedFc", "in"), wire("left", "result", "leftFc", "in"),
      wire("budgetFc", "out", "report", "budget"), wire("paidFc", "out", "report", "paid"), wire("owedFc", "out", "report", "owed"), wire("leftFc", "out", "report", "left"),
      wire("chart", "chart", "report", "chart"), wire("sort", "frame", "report", "byCategory"),
      wire("report", "document", "write", "in"),
    ],
  };
}

/** Center of the first visible element matching sel (and text, when given), searching shadow roots too. */
export function rectIn(page, sel, text) {
  return page.evaluate((sel, text) => {
    const roots = [document, ...[...document.querySelectorAll("*")].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
    for (const root of roots) {
      const el = [...root.querySelectorAll(sel)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (text === undefined || e.textContent.trim() === text);
      });
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  }, sel, text);
}
export async function need(page, sel, text) {
  const r = await rectIn(page, sel, text);
  if (!r) throw new Error(`no ${sel}${text ? ` "${text}"` : ""} in ${await page.title()}`);
  return r;
}

/** Opens a note in live preview, or in reading view with `reading`, scrolled to the top. */
export async function openNote(c, file, { reading = false } = {}) {
  await c.obs(async (f, r) => {
    const app = window.app;
    const tf = app.vault.getAbstractFileByPath(f);
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(tf, { state: r ? { mode: "preview" } : { mode: "source", source: false } });
    // A note first drawn right after the plugin loads can miss its chips; one rebuild draws them.
    await leaf.rebuildView();
    // A collapsed sidebar defers its views, so the explorer may have nothing to reveal with.
    app.workspace.getLeavesOfType("file-explorer")[0]?.view.revealInFolder?.(tf);
    leaf.view.editor?.scrollTo(0, 0);
    leaf.view.previewMode?.applyScroll?.(0);
    document.activeElement?.blur?.();
  }, file, reading);
  await c.sleep(900);
}

/** Closes every window but the main one, such as a Settings an earlier take left open. */
export async function closeOtherWindows(c) {
  for (const p of await c.browser.pages()) if (p !== c.page) await p.evaluate(() => window.close()).catch(() => {});
  await c.sleep(400);
}

export const ROUNDTRIP = {
  "obs-look": {
    app: "obsidian",
    fresh: true,
    caption: ["Solenoid Properties for Obsidian", "A free plugin brings Solenoid's value types and table editors to your notes. The look is optional and uses the app's palettes."],
    async setup(c) {
      await closeOtherWindows(c);
      await c.obs(async () => { await window.app.plugins.plugins["solenoid-properties"].setLook(false); });
      // Settings reopens on its last tab, so the gear on camera lands on the plugin's page.
      await c.obs(() => { window.app.setting.open(); window.app.setting.openTabById("solenoid-properties"); });
      await c.sleep(1200);
      await closeOtherWindows(c);
      await openNote(c, NOTE);
      await c.hand.show(900, 430);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(900);
      const gear = await c.page.evaluate(() => {
        const b = [...document.querySelectorAll("svg.lucide-settings")].map((e) => e.closest(".clickable-icon")).find((e) => e && e.getBoundingClientRect().y > 600);
        const r = b.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      });
      await hand.click(gear);
      const { win, hand: wh } = await c.enterWindow(/^Settings/);
      await sleep(900);
      const toggle = await win.evaluate(() => {
        const row = [...document.querySelectorAll(".setting-item")].find((s) => s.querySelector(".setting-item-name")?.textContent.trim() === "Solenoid look");
        const r = row.querySelector(".checkbox-container").getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      });
      await wh.click(toggle);
      await sleep(1500);
      await wh.click(await need(win, ".titlebar-button.mod-close"));
      await c.leaveWindow(wh);
      await sleep(300);
      await hand.move(760, 470, { ms: 900 });
      await sleep(1300);
    },
  },

  palettes: {
    app: "both",
    caption: ["Palettes and light mode", "The app and the plugin share every palette, accent and light mode, so a graph and its vault can match."],
    hold: 2.2,
    states: [
      { palette: "Default", accent: "gold", mode: "dark" },
      { palette: "Orchard", accent: "teal", mode: "dark" },
      { palette: "Blueprint", accent: "blue", mode: "dark" },
      { palette: "Default", accent: "violet", mode: "light" },
      { palette: "Solarized", accent: "gold", mode: "light" },
    ],
    async setup({ sol, obs }) {
      await sol.legend(false);
      await sol.example("chart-showcase");
      await sol.frame(["Treemap", "Sankey"], { pad: 0.04, maxK: 1.1 });
      await closeOtherWindows(obs);
      await obs.obs(async () => { await window.app.plugins.plugins["solenoid-properties"].setLook(true); });
      await openNote(obs, "Solenoid/Property types.md");
    },
    async apply({ sol, obs }, s) {
      // Fired on a timer: awaited across the protocol, a palette swap loses the call ("Promise was collected").
      await sol.demo(({ palette, accent, mode }) => {
        setTimeout(async () => {
          (await import("/src/graph/palette.ts")).paletteStore.setActiveBase(palette);
          const { appThemeStore } = await import("/src/graph/appTheme.ts");
          appThemeStore.setAccent(accent);
          appThemeStore.setMode(mode);
        }, 0);
      }, s);
      await obs.obs(async ({ palette, accent, mode }) => {
        const pl = window.app.plugins.plugins["solenoid-properties"];
        window.app.changeTheme(mode === "light" ? "moonstone" : "obsidian");
        await pl.setPalette(palette);
        await pl.setAccent(accent);
      }, s);
    },
    async teardown(ctx) { await this.apply(ctx, this.states[0]); },
  },

  "obs-property": {
    app: "obsidian",
    caption: ["Frame properties", "Frames, cubes, lists and matrices join Obsidian's property types. The note keeps plain YAML, so it still reads without the plugin."],
    async setup(c) {
      await closeOtherWindows(c);
      fs.copyFileSync(path.join(ROOT, "demo-vault", NOTE), path.join(VAULT, NOTE));
      await c.obs(async () => {
        const app = window.app, pl = app.plugins.plugins["solenoid-properties"];
        await pl.setLook(true);
        await app.metadataTypeManager.unsetType("costs");
        if (pl.data.columnTypes?.costs) { delete pl.data.columnTypes.costs; await pl.saveData(pl.data); }
      });
      await c.sleep(600);
      await openNote(c, NOTE);
      // Copied from a spreadsheet, without the trailing newline a text editor's selection leaves off.
      await c.obs((t) => window.require("electron").clipboard.writeText(t), fs.readFileSync(COSTS_CSV, "utf8").replace(/\n+$/, ""));
      await c.hand.show(1000, 560);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(500);
      await hand.click(await need(page, ".metadata-add-button"));
      await sleep(300);
      await hand.type("costs", { cps: 9 });
      await sleep(250);
      await hand.press("Enter");
      await sleep(350);
      const icon = await page.evaluate(() => {
        const r = document.querySelector('.metadata-property[data-property-key="costs"] .metadata-property-icon').getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      });
      await hand.click(icon);
      await sleep(350);
      const type = await need(page, ".menu .menu-item", "Property type");
      await hand.move(type.cx, type.cy, { ms: 400 });
      await sleep(550);
      const frame = await need(page, ".menu .menu-item", "Frame");
      await hand.move(frame.x + 20, type.cy, { ms: 300, bow: 0 });
      await hand.move(frame.cx, frame.cy, { ms: 600 });
      await sleep(200);
      await hand.click();
      await sleep(550);
      await hand.click(await need(page, '.metadata-property[data-property-key="costs"] .solenoid-property-chip'));
      await sleep(650);
      await hand.click(await need(page, "button", "CSV"));
      await sleep(350);
      const box = await need(page, "textarea");
      await hand.click({ x: box.x + 16, y: box.y + 12 });
      await sleep(250);
      await hand.chord("Control", "v", ["Ctrl", "V"]);
      await sleep(800);
      await hand.click(await need(page, "button", "Grid"));
      await sleep(1500);
      await hand.click(await need(page, "button", "Save"));
      await sleep(400);
      const chip = await need(page, '.metadata-property[data-property-key="costs"] .solenoid-property-chip');
      await hand.move(chip.cx + 120, chip.cy + 40, { ms: 600 });
      await sleep(1300);
    },
  },

  "import-pair": {
    app: "both",
    panels: ["obs", "sol"],
    hold: 3.0,
    states: [{}],
    async setup({ sol, obs }) {
      await sol.legend(false);
      await sol.doc(costsGraph(false), DOC);
      await sol.frame(["Kitchen remodel"], { pad: 0.06, maxK: 1.9, dy: 90 });
      await sol.box(await sol.socketRow("Kitchen remodel", "costs", "out"), 4);
      await closeOtherWindows(obs);
      await openNote(obs, NOTE);
      const row = await need(obs.page, '.metadata-property[data-property-key="costs"]');
      await obs.box(row, 4);
    },
    async apply() {},
    async teardown({ sol, obs }) { await sol.clearBoxes(); await obs.clearBoxes(); },
  },

  "sol-import": {
    vault: true,
    caption: ["Import Obsidian Note", "Every property arrives typed, down to the column types set in Obsidian. Vault Folder reads a whole folder as one table."],
    async setup(c) {
      await c.legend(false);
      const current = await c.demo(async () => (await import("/src/graph/documentStore.ts")).documentStore.currentName());
      if (current !== DOC) await c.doc(costsGraph(false), DOC);
      await c.frame(["Kitchen remodel"], { pad: 0.06, maxK: 1.9, dy: 90 });
      await c.box(await c.socketRow("Kitchen remodel", "costs", "out"), 4);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(1400);
      await c.clearBoxes();
      await c.fly(["Kitchen remodel", "GROUPBY", "Biggest first", "Costs by category"], { pad: 0.04, maxK: 1.0, dy: -30 }, 1500);
      const p = await c.toScreen(460, 360);
      await hand.show(p.x, p.y);
      await sleep(500);
      const from = await c.socket("Kitchen remodel", "costs", "out");
      const to = await c.socket("GROUPBY", "frame", "in");
      await hand.drag(from, to, { ms: 1100 });
      await sleep(500);
      const rest = await c.toScreen(700, 330);
      await hand.move(rest.x, rest.y, { ms: 800 });
      await sleep(2600);
    },
  },

  "sol-write": {
    vault: true,
    caption: ["Reports and Write to Obsidian", "A Report is Markdown with Knap tags for live values. In the vault it becomes a plain note, its chart saved as an image."],
    async setup(c) {
      await c.legend(false);
      const current = await c.demo(async () => (await import("/src/graph/documentStore.ts")).documentStore.currentName());
      if (current !== DOC) await c.doc(costsGraph(true), DOC);
      await c.openReport("Cost report", { dock: true, tab: "Draft" });
      await c.frame(["Cost report", "Write to Obsidian"], { pad: 0.05, maxK: 1.3, dy: -10 });
      const p = await c.toScreen(1600, 380);
      await c.hand.show(p.x, p.y);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(900);
      // The Knap tags boxed, and the frame zoomed onto the draft in compose.mjs.
      const { tags, draft } = await c.demo(() => {
        const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        return { tags: [...document.querySelectorAll(".knap-tag")].map(rect), draft: rect(document.querySelector(".report-source__ta")) };
      });
      for (const t of tags) await c.box(t, 3);
      const s = VIEW.scale, top = tags.reduce((m, t) => Math.min(m, t.y), Infinity) - 40;
      c.rec.at("zoom", { x: draft.x * s, y: top * s, w: draft.w * s, h: 300 * s });
      await sleep(2600);
      c.rec.at("unzoom");
      await c.clearBoxes();
      await sleep(900);
      await hand.click(await c.find(".report-viewtoggle__seg", "Preview"));
      await sleep(1600);
      const armed = await c.demo(async () => {
        const n = await window.__demo.byLabel("Write to Obsidian");
        const el = (await window.__demo.view()).nodeElement(n.id);
        const box = [...el.querySelectorAll("label.sol-write__armed")].find((l) => l.textContent.trim() === "Armed").querySelector("input");
        const r = box.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      });
      await hand.click(armed);
      await sleep(350);
      await hand.click(await c.within("Write to Obsidian", "button.sol-write__run", "Run"));
      await sleep(1900);
      await hand.click(await c.within("Write to Obsidian", "button", "Open in Obsidian"));
      await sleep(1500);
    },
  },

  "obs-open": {
    app: "obsidian",
    caption: ["Back in Obsidian", "The report is an ordinary note, so it syncs, links and searches like the rest of the vault."],
    async setup(c) {
      await closeOtherWindows(c);
      if (!fs.existsSync(path.join(VAULT, REPORT))) throw new Error(`no ${REPORT} yet: record sol-write first`);
      await openNote(c, REPORT);
      await c.hand.hide();
    },
    async act(c) {
      const { sleep } = c;
      await sleep(1600);
      await c.obs(async () => {
        // Live preview pads past the end of a note, so stop where the table's last row sits low in the view.
        const el = window.app.workspace.getMostRecentLeaf().view.containerEl.querySelector(".cm-scroller");
        const table = [...el.querySelectorAll("table")].at(-1);
        const from = el.scrollTop;
        const to = from + table.getBoundingClientRect().bottom - el.getBoundingClientRect().top - el.clientHeight * 0.88;
        const t0 = performance.now(), ms = 2600;
        await new Promise((res) => {
          const step = (now) => {
            const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            el.scrollTop = from + (to - from) * e;
            if (t < 1) requestAnimationFrame(step); else res();
          };
          requestAnimationFrame(step);
        });
      });
      await sleep(3000);
    },
  },
};
