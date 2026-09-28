// [[B3]] sameNodeEverywhere
// The dmatrix cut: choosing an apartment with the Decision Matrix Bases View plugin, all in Obsidian. Both plugins
// are switched on and the look picked; each apartment's note gets a scores Frame; a decision note embeds a base whose
// view is the Decision Matrix; the weights go in, negative for rent, commute and noise; then the matrix is played
// with: a weight pushed past its flip point, the Rankings breakdown, a blank scored as the median, a new criterion,
// and the result written back to the note.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./rig.mjs";
import { noteOnly } from "./obsidian.mjs";
import { rectIn, openNote, closeOtherWindows } from "./roundtrip.mjs";
import { look, obsZoom } from "./plugin.mjs";

/** The Decision Matrix plugin's build: main.js, manifest.json and styles.css at the root of its checkout. */
const DMATRIX = process.env.DMATRIX ?? path.join(ROOT, "..", "dmatrix-bases-view");
export const DM_ID = "decision-matrix-bases-view";
export const FOLDER = "Apartments";
export const DECISION = "Which apartment.md";

/** The four apartments: what the note says about each, and the scores it gets. Light is left blank on the studio. */
export const APARTMENTS = [
  {
    name: "Maple St loft",
    address: "14 Maple St, apt 5",
    body: "Top floor of an old brick warehouse. Huge windows, a bit of street noise. Dana, the landlord, lives downstairs and is fine with cats.",
    scores: { rent: 2150, commute: 35, size: 820, light: 9, noise: 6, laundry: true, pets: true, landlord: "Dana" },
  },
  {
    name: "Harbor View 4B",
    address: "88 Harbor Way, 4B",
    body: "Newer building by the water, twelve minutes from work. Washer and dryer in the unit. No pets allowed.",
    scores: { rent: 2600, commute: 12, size: 700, light: 7, noise: 4, laundry: true, pets: false, landlord: "Coastline Mgmt" },
  },
  {
    name: "Elm Court garden",
    address: "3 Elm Court",
    body: "Ground floor with its own patio. Quiet street, cheapest of the four, but forty minutes out and the laundry is in the basement.",
    scores: { rent: 1750, commute: 40, size: 900, light: 5, noise: 2, laundry: false, pets: true, landlord: "Mr. Ortiz" },
  },
  {
    name: "Downtown studio",
    address: "210 Main St, #6",
    body: "Small, right in the middle of everything. Eight minutes to work. Only saw it at night, so no idea about the light.",
    scores: { rent: 1900, commute: 8, size: 480, light: null, noise: 8, laundry: false, pets: false, landlord: null },
  },
];
export const COLUMNS = ["rent", "commute", "size", "light", "noise", "laundry", "pets", "landlord"];
export const COLUMN_TYPES = { rent: "number", commute: "number", size: "number", light: "number", noise: "number", laundry: "logical", pets: "logical", landlord: "string" };

const yamlCell = (v) => (v === null ? "null" : typeof v === "string" ? JSON.stringify(v) : String(v));
/** An apartment's note: its address, and its scores Frame when `scored`. */
export function apartmentNote(apt, scored) {
  const scores = scored ? ["scores:", ...COLUMNS.map((k, i) => `${i ? "    " : "  - "}${k}: ${yamlCell(apt.scores[k])}`)] : [];
  return ["---", `address: ${apt.address}`, ...scores, "---", "", apt.body, ""].join("\n");
}

/** The cut's own vault: the four apartments unscored, both plugins installed and switched off, the look off. */
export function prepareVault(vault) {
  for (const e of fs.readdirSync(vault)) if (!e.startsWith(".")) fs.rmSync(path.join(vault, e), { recursive: true, force: true });
  fs.mkdirSync(path.join(vault, FOLDER));
  for (const a of APARTMENTS) fs.writeFileSync(path.join(vault, FOLDER, `${a.name}.md`), apartmentNote(a, false));
  fs.writeFileSync(path.join(vault, "Welcome.md"), "Looking for a new place.\n");
  const cfg = path.join(vault, ".obsidian");
  fs.writeFileSync(path.join(cfg, "types.json"), JSON.stringify({ types: {} }, null, 2));
  fs.writeFileSync(path.join(cfg, "app.json"), JSON.stringify({ readableLineLength: false, alwaysUpdateLinks: true }, null, 2));
  fs.writeFileSync(path.join(cfg, "community-plugins.json"), JSON.stringify(["solenoid-properties", DM_ID], null, 2));
  const dm = path.join(cfg, "plugins", DM_ID);
  fs.mkdirSync(dm, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) {
    const src = path.join(DMATRIX, f);
    if (!fs.existsSync(src)) throw new Error(`no ${f} in ${DMATRIX}: build the plugin there (npm run build) or set DMATRIX`);
    fs.copyFileSync(src, path.join(dm, f));
  }
}


/** The element's rect once it shows, waiting out a view that is still drawing after a note opens. */
async function need(page, sel, text) {
  for (let i = 0; i < 24; i++) {
    const r = await rectIn(page, sel, text);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`no ${sel}${text ? ` "${text}"` : ""} in ${await page.title()}`);
}

export const BASE = "Untitled.base";
const LOOK = { palette: "Orchard", accent: "teal", mode: "dark" };
/** The weights the story sets, in column order. */
export const WEIGHTS = { rent: -3, commute: -2, size: 2, light: 3, noise: -1, laundry: 2, pets: 2 };
const M = ".dmv-matrix";
const R = ".dmv-rankings";
const FILTER = ["    filters:", "      and:", `        - file.inFolder("${FOLDER}")`];

/** The base as the decision scene leaves it: one Matrix view over the folder, and a Rankings view when `rankings`. */
function baseYaml({ rankings = false } = {}) {
  return [
    "views:", "  - type: decision-matrix", "    name: Matrix", ...FILTER,
    ...(rankings ? ["  - type: decision-matrix-rankings", "    name: Rankings", ...FILTER] : []), "",
  ].join("\n");
}
export const RANKINGS_EMBED = `![[${BASE}#Rankings]]`;
const RANKED = "## Ranked";
const decisionNote = (weights, bars) => [
  ...(weights ? ["---", "weights:", ...Object.entries(weights).flatMap(([c, w]) => [`  - Criterion: ${c}`, `    Weight: ${w}`, "    Norm: null"]), "---", ""] : []),
  "Four places, one lease.", "", `![[${BASE}]]`, "", ...(bars ? [RANKED, "", RANKINGS_EMBED, ""] : []),
].join("\n");

/**
 * The vault as it stands at a point in the story, so any scene can be recorded alone:
 * `scored` names the apartments with a scores Frame, `decision` writes the decision note and its base,
 * `weights` gives the note its weights Frame, `rankings` adds the Rankings view and `bars` embeds it under the matrix.
 */
async function stage(c, { scored = [], decision = false, weights = null, rankings = false, bars = false } = {}) {
  const files = APARTMENTS.map((a) => [`${FOLDER}/${a.name}.md`, apartmentNote(a, scored.includes(a.name))]);
  await c.obs(async (files, decision, base, note, types) => {
    const app = window.app, v = app.vault;
    const put = async (p, text) => {
      const f = v.getAbstractFileByPath(p);
      if (f) await v.modify(f, text); else await v.create(p, text);
    };
    const drop = async (p) => { const f = v.getAbstractFileByPath(p); if (f) await v.delete(f); };
    for (const [p, text] of files) await put(p, text);
    const sp = app.plugins.plugins["solenoid-properties"];
    if (sp) {
      app.metadataTypeManager.setType("scores", "solenoid-frame");
      app.metadataTypeManager.setType("weights", "solenoid-frame");
      await sp.api?.setColumnTypes("scores", types);
      await sp.api?.setColumnTypes("weights", { Criterion: "string", Weight: "number", Norm: "string" });
    }
    await drop("result.md");
    if (decision) { await put(base.path, base.text); await put(note.path, note.text); }
    else { await drop(base.path); await drop(note.path); }
  }, files, decision, { path: BASE, text: baseYaml({ rankings }) }, { path: DECISION, text: decisionNote(weights, bars) }, COLUMN_TYPES);
  await c.sleep(600);
}

/** Obsidian down to the note, in the story's look, at `zoom`. */
async function view(c, file, { zoom = 1, reading = false } = {}) {
  await closeOtherWindows(c);
  await noteOnly(c.page);
  await obsZoom(c, zoom);
  await look(c, LOOK);
  await c.obs(() => { for (const leaf of window.app.workspace.getLeavesOfType("markdown").slice(1)) leaf.detach(); });
  if (file) await openNote(c, file, { reading });
}

/** Scrolls the note so a base's toolbar (the `nth` embed's) sits near the top of the pane, its view below it. */
async function toBase(c, nth = 0, smooth = false) {
  await c.obs((n, sm) => {
    const view = window.app.workspace.getLeavesOfType("markdown")[0].view;
    const scroller = view.getMode?.() === "preview" ? view.containerEl.querySelector(".markdown-preview-view") : view.editor.cm.scrollDOM;
    const bar = view.containerEl.querySelectorAll(".bases-toolbar")[n];
    if (scroller && bar) scroller.scrollTo({ top: scroller.scrollTop + bar.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12, behavior: sm ? "smooth" : "instant" });
  }, nth, smooth);
  await c.sleep(smooth ? 1200 : 500);
}

/** Types into the note at the cursor a character at a time, as the keyboard would, but past Obsidian's link
 *  suggester, which rewrites a typed `![[…]]` as it goes. */
async function typeInNote(c, text, { cps = 16 } = {}) {
  for (const ch of text) {
    await c.obs((t) => window.app.workspace.getLeavesOfType("markdown")[0].view.editor.replaceSelection(t), ch);
    await c.sleep((1000 / cps) * (0.6 + Math.random() * 0.8));
  }
}

const blur = (c) => c.obs(() => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; el?.blur?.(); document.activeElement?.blur?.(); });

/** Clicks into a text box and replaces what it holds, as a person would: select all, type. */
async function retype(c, target, text, { cps = 9 } = {}) {
  await c.hand.click(target);
  await c.sleep(150);
  await c.hand.chord("Control", "a");
  await c.hand.type(text, { cps });
  await c.sleep(150);
  await c.hand.press("Enter");
}

/** A property added from the properties block, typed as Frame unless its type is already set. */
async function addProperty(c, key, { frame = false } = {}) {
  const { hand, sleep, page } = c;
  await hand.click(await need(page, ".metadata-add-button"));
  await sleep(300);
  await hand.type(key, { cps: 10 });
  await sleep(200);
  await hand.press("Enter");
  await sleep(450);
  if (!frame) return;
  await hand.click(await need(page, `.metadata-property[data-property-key="${key}"] .metadata-property-icon`));
  await sleep(350);
  const type = await need(page, ".menu .menu-item", "Property type");
  await hand.move(type.cx, type.cy, { ms: 400 });
  await sleep(600);
  const frameItem = await need(page, ".menu .menu-item", "Frame");
  // Across into the submenu first, then down it: a diagonal would brush the items below Property type.
  await hand.move(frameItem.x + 30, type.cy, { ms: 300, bow: 0 });
  await hand.move(frameItem.cx, frameItem.cy, { ms: 700 });
  await sleep(250);
  await hand.click();
  await sleep(600);
}

/** Types an apartment's scores into its Frame's CSV view: the header, then its one row. */
async function typeScores(c, apt, { header = true } = {}) {
  const { hand, sleep, page } = c;
  await hand.click(await need(page, "button", "CSV"));
  await sleep(500);
  const box = await need(page, "textarea");
  await hand.click({ x: box.x + 16, y: box.y + 14 });
  await sleep(200);
  await hand.chord("Control", "a");
  if (header) {
    await hand.type(COLUMNS.join(","), { cps: 22 });
    await hand.press("Enter");
  }
  const cell = (v) => (v === null ? "" : v === true ? "TRUE" : v === false ? "FALSE" : String(v));
  await hand.type(COLUMNS.map((k) => cell(apt.scores[k])).join(","), { cps: 14 });
  await sleep(400);
}

const chip = (key) => `.metadata-property[data-property-key="${key}"] .solenoid-property-chip`;
const weightBox = (k) => `${M} input[aria-label="Weight of ${k}"]`;
const cellBox = (k, name) => `${M} input[aria-label="${k} of ${name}"]`;
const headBtn = (c, name) => need(c.page, `${M} .dmv-head-btn`, name);
const menuItem = (c, title) => need(c.page, ".menu .menu-item", title);

export const DMATRIX_SCENES = {
  "dm-intro": {
    app: "obsidian",
    fresh: prepareVault,
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true, bars: true });
      await view(c, DECISION, { reading: true, zoom: 1.1 });
      await toBase(c);
    },
    async act(c) { await c.sleep(5200); },
  },

  "dm-plugins": {
    app: "obsidian",
    chapter: { line: "A Decision Matrix can help you decide." },
    caption: ["Get started", "Install Solenoid Properties and Decision Matrix Bases View from Community plugins, then switch them both on."],
    async setup(c) {
      await stage(c);
      await closeOtherWindows(c);
      await c.obs(async () => {
        const { plugins } = window.app;
        await plugins.plugins["solenoid-properties"]?.setLook(false);
        await plugins.disablePluginAndSave("decision-matrix-bases-view");
        await plugins.disablePluginAndSave("solenoid-properties");
        window.app.changeTheme("obsidian");
      });
      await noteOnly(c.page);
      await obsZoom(c, 1);
      await openNote(c, "Welcome.md");
      // Settings reopens on its last tab, so the shortcut on camera lands on Community plugins.
      await c.obs(() => { window.app.setting.open(); window.app.setting.openTabById("community-plugins"); });
      await c.sleep(1200);
      await closeOtherWindows(c);
      await c.hand.show(760, 420);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(900);
      await hand.chord("Control", ",", ["Ctrl", ","]);
      const { win, hand: wh } = await c.enterWindow(/^Settings/);
      await sleep(900);
      const row = (name) => win.evaluate((n) => {
        const item = [...document.querySelectorAll(".setting-item")].find((s) => s.querySelector(".setting-item-name")?.textContent.includes(n));
        const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; };
        const gear = [...item.querySelectorAll(".clickable-icon")].find((b) => /options/i.test(b.getAttribute("aria-label") ?? ""));
        return { toggle: box(item.querySelector(".checkbox-container")), gear: gear && box(gear), row: box(item) };
      }, name);
      const browse = await need(win, "button", "Browse");
      await wh.move(browse.cx, browse.cy, { ms: 800 });
      await c.box(browse, 5, win);
      await sleep(1300);
      await c.clearBoxes(win);
      await wh.click((await row("Solenoid Properties")).toggle);
      await sleep(900);
      await wh.click((await row("Decision Matrix")).toggle);
      // The caption waits for both switches: it covers the list's lower rows.
      await sleep(500);
      c.rec.at("caption");
      await wh.move(1100, 180, { ms: 700 });
      await sleep(3600);
    },
  },

  "dm-look": {
    app: "obsidian",
    caption: ["The Solenoid look", "Solenoid Properties can restyle the vault, and the Decision Matrix is drawn to match. Pick a palette and an accent."],
    async setup(c) {
      await closeOtherWindows(c);
      await c.obs(async () => {
        const { plugins } = window.app;
        for (const id of ["solenoid-properties", "decision-matrix-bases-view"]) if (!plugins.enabledPlugins.has(id)) await plugins.enablePluginAndSave(id);
        const sp = plugins.plugins["solenoid-properties"];
        await sp.setLook(false);
        await sp.setPalette("Default");
        await sp.setAccent("gold");
        window.app.changeTheme("obsidian");
      });
      await stage(c);
      await noteOnly(c.page);
      await obsZoom(c, 1);
      await openNote(c, `${FOLDER}/Maple St loft.md`);
      await c.obs(() => { window.app.setting.open(); window.app.setting.openTabById("solenoid-properties"); });
      await c.sleep(1200);
      await c.hand.show(900, 420);
    },
    async act(c) {
      const { sleep } = c;
      const win = await (await import("./obsidian.mjs")).obsidianWindow(c.browser, /^Settings/);
      const { hand: wh } = await c.enterWindow(/^Settings/);
      await sleep(800);
      const toggle = await win.evaluate(() => {
        const row = [...document.querySelectorAll(".setting-item")].find((s) => s.querySelector(".setting-item-name")?.textContent.trim() === "Solenoid look");
        const r = row.querySelector(".checkbox-container").getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      });
      await wh.click(toggle);
      await sleep(1400);
      // The palette: a native select, so it opens and takes a key like any other.
      const select = await need(win, ".solenoid-settings-palette select");
      await wh.click(select);
      await sleep(700);
      await wh.press(LOOK.palette[0].toLowerCase());
      await sleep(250);
      await wh.press("Enter");
      await sleep(1300);
      const swatch = await win.evaluate((a) => {
        const host = document.querySelector(".solenoid-settings-swatches");
        const el = [...(host?.shadowRoot ?? host).querySelectorAll("button")].find((b) => b.title === a);
        const r = el?.getBoundingClientRect();
        return r && { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }, LOOK.accent);
      if (!swatch) throw new Error(`no ${LOOK.accent} swatch in the Solenoid Properties settings`);
      await wh.click(swatch);
      await sleep(1500);
      await wh.click(await need(win, ".titlebar-button.mod-close"));
      await c.leaveWindow(wh);
      await sleep(1400);
    },
  },

  "dm-score": {
    app: "obsidian",
    caption: ["1. Score each option", "Give each apartment a scores Frame with a column per thing you care about. Checkboxes count as 1 or 0, and text like the landlord is kept but not scored."],
    async setup(c) {
      await c.obs(() => window.app.metadataTypeManager.unsetType?.("scores"));
      await stage(c);
      await c.obs(() => { const t = window.app.metadataTypeManager; t.unsetType?.("scores"); });
      await view(c, `${FOLDER}/Maple St loft.md`, { zoom: 1 });
      await blur(c);
      await c.hand.show(700, 420);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      const apt = APARTMENTS[0];
      await sleep(900);
      const body = await c.obs(() => {
        const line = [...document.querySelectorAll(".markdown-source-view .cm-line")].find((l) => l.textContent.startsWith("Top floor"));
        const r = line.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      await c.box(body, 5);
      await sleep(1400);
      await c.clearBoxes();
      await addProperty(c, "scores", { frame: true });
      await hand.click(await need(page, chip("scores")));
      await sleep(900);
      c.rec.at("fast", { rate: 3 });
      await typeScores(c, apt);
      c.rec.at("unfast");
      await sleep(300);
      await hand.click(await need(page, "button", "Form"));
      await sleep(2200);
      await hand.click(await need(page, "button", "Save"));
      await sleep(900);
      await c.box(await need(page, `.metadata-property[data-property-key="scores"]`), 4);
      await sleep(1500);
      await c.clearBoxes();
    },
  },

  "dm-score-more": {
    app: "obsidian",
    caption: ["Blanks are fine", "Harbor View gets its Frame the same way. The studio was only seen at night, so its light stays blank for now."],
    async setup(c) {
      await stage(c, { scored: ["Maple St loft", "Elm Court garden"] });
      await view(c, `${FOLDER}/Harbor View 4B.md`, { zoom: 1 });
      await blur(c);
      await c.hand.show(700, 420);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(700);
      c.rec.at("fast", { rate: 4 });
      await addProperty(c, "scores");
      await hand.click(await need(page, chip("scores")));
      await sleep(700);
      await typeScores(c, APARTMENTS[1]);
      await hand.click(await need(page, "button", "Save"));
      await sleep(500);
      c.rec.at("unfast");
      // The studio, already scored, with its light blank.
      await c.obs(async (p, text) => { await window.app.vault.modify(window.app.vault.getAbstractFileByPath(p), text); }, `${FOLDER}/Downtown studio.md`, apartmentNote(APARTMENTS[3], true));
      await c.obs(async (p) => {
        const leaf = window.app.workspace.getLeavesOfType("markdown")[0];
        await leaf.openFile(window.app.vault.getAbstractFileByPath(p), { state: { mode: "source", source: false } });
      }, `${FOLDER}/Downtown studio.md`);
      await sleep(900);
      await hand.click(await need(page, chip("scores")));
      await sleep(900);
      await hand.click(await need(page, "button", "Form"));
      await sleep(700);
      const boxes = await c.obs(() => {
        const roots = [document, ...[...document.querySelectorAll("*")].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
        for (const root of roots) {
          const labels = [...root.querySelectorAll(".table-popup__form-box")];
          const light = labels.find((l) => /^light/.test(l.textContent.trim()));
          if (light) { const r = light.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }
        }
        return null;
      });
      if (boxes) { await c.box(boxes, 3); await hand.move(boxes.x + boxes.w + 60, boxes.cy, { ms: 700 }); }
      await sleep(2600);
      await c.clearBoxes();
      await hand.click(await need(page, "button", "Cancel"));
      await sleep(700);
    },
  },

  "dm-base": {
    app: "obsidian",
    caption: ["2. Add a base", "A base lists the notes in the Apartments folder. Its Decision Matrix layout reads their scores and ranks them."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name) });
      await view(c, "Welcome.md", { zoom: 1.1 });
      await c.obs(() => {
        window.app.vault.setConfig("autoPairBrackets", false);
        for (const leaf of window.app.workspace.getLeavesOfType("markdown")) leaf.detach();
      });
      await c.sleep(500);
      await c.hand.show(700, 360);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(800);
      await hand.chord("Control", "n", ["Ctrl", "N"]);
      await sleep(700);
      await hand.type("Which apartment", { cps: 12 });
      await hand.press("Enter");
      await sleep(250);
      await hand.type("Four places, one lease.", { cps: 14 });
      await hand.press("Enter");
      await hand.press("Enter");
      await sleep(400);
      await hand.chord("Control", "p", ["Ctrl", "P"]);
      await sleep(500);
      await hand.type("insert new base", { cps: 16 });
      await sleep(500);
      await hand.press("Enter");
      await sleep(1400);
      // Only the apartments: a filter on the folder.
      c.rec.at("fast", { rate: 2 });
      await hand.click(await need(page, ".bases-toolbar .text-button-label", "Filter"));
      await sleep(700);
      await hand.click(await need(page, ".combobox-button.filter-operator"));
      await sleep(600);
      await hand.click(await need(page, ".suggestion-item", "in folder"));
      await sleep(500);
      await hand.click(await need(page, ".filter-rhs-container input"));
      await sleep(250);
      await hand.type(FOLDER, { cps: 14 });
      await sleep(400);
      await hand.press("Enter");
      await sleep(500);
      await hand.press("Escape");
      c.rec.at("unfast");
      await sleep(700);
      // The view's layout: Decision Matrix, and a name to match.
      await hand.click(await need(page, ".bases-toolbar .text-button-label", "Table"));
      await sleep(600);
      await hand.click(await need(page, ".bases-toolbar-menu-item-icon"));
      await sleep(700);
      await retype(c, await need(page, ".input-row-content input"), "Matrix", { cps: 10 });
      await sleep(300);
      await hand.click(await need(page, ".input-row-content .combobox-button"));
      await sleep(600);
      await hand.click(await need(page, ".suggestion-item", "Decision Matrix"));
      await sleep(900);
      await hand.click(await need(page, ".bases-toolbar-menu-container-header .close-icon"));
      await sleep(400);
      await blur(c);
      await hand.move(1180, 250, { ms: 800 });
      await sleep(2400);
    },
  },
  "dm-weights": {
    app: "obsidian",
    caption: ["Weights", "A weight says how much a criterion counts. A negative weight means lower is better, for rent, commute and noise."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, 1])) });
      await view(c, DECISION, { zoom: 1.1 });
      await toBase(c);
      await blur(c);
      await c.hand.show(900, 300);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(900);
      // Every weight starts at 1, so the dearest rent counts in its favor.
      await c.box(await need(page, `${M} .dmv-lead`), 4);
      await c.box(await need(page, weightBox("rent")), 4);
      await sleep(1800);
      await c.clearBoxes();
      await retype(c, await need(page, weightBox("rent")), "-3");
      await sleep(900);
      // Commute from its menu, then a step with the arrow key.
      await hand.click(await headBtn(c, "commute"));
      await sleep(500);
      await hand.click(await menuItem(c, "Lower is better"));
      await sleep(900);
      await hand.click(await need(page, weightBox("commute")));
      await sleep(250);
      await hand.press("ArrowDown", "↓");
      await sleep(900);
      c.rec.at("fast", { rate: 3 });
      for (const [k, w] of [["size", "2"], ["light", "3"]]) { await retype(c, await need(page, weightBox(k)), w, { cps: 8 }); await sleep(400); }
      await hand.click(await headBtn(c, "noise"));
      await sleep(400);
      await hand.click(await menuItem(c, "Lower is better"));
      await sleep(500);
      for (const [k, w] of [["laundry", "2"], ["pets", "2"]]) { await retype(c, await need(page, weightBox(k)), w, { cps: 8 }); await sleep(400); }
      c.rec.at("unfast");
      await blur(c);
      await hand.move(1150, 180, { ms: 700 });
      await sleep(1500);
      await c.box(await need(page, `${M} .dmv-lead`), 4);
      await sleep(2000);
      await c.clearBoxes();
    },
  },

  "dm-ranking": {
    app: "obsidian",
    caption: ["3. You have a ranking", "The line on top names the leader, the runner-up and the margin. Embed the base's Rankings view for the same result as bars."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true });
      await view(c, DECISION, { zoom: 1.1 });
      await c.obs(() => { window.app.vault.setConfig("autoPairBrackets", false); });
      await toBase(c);
      await blur(c);
      await c.hand.show(1000, 200);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(900);
      await c.box(await need(page, `${M} .dmv-lead`), 4);
      await sleep(1600);
      await c.clearBoxes();
      const scores = await need(page, `${M} .dmv-row .dmv-score`);
      await hand.move(scores.cx, scores.cy, { ms: 800 });
      await sleep(900);
      // Below the matrix, the same base again at its Rankings view.
      const table = await need(page, `${M} .dmv-table-wrap, ${M} table`);
      await hand.click({ x: 400, y: Math.min(690, table.y + table.h + 50) });
      await c.obs(() => {
        const e = window.app.workspace.getLeavesOfType("markdown")[0].view.editor;
        e.setCursor({ line: e.lastLine(), ch: 0 });
        e.focus();
      });
      await sleep(250);
      await hand.type(RANKED, { cps: 14 });
      await hand.press("Enter");
      await typeInNote(c, RANKINGS_EMBED);
      await sleep(400);
      await blur(c);
      await hand.move(1150, 180, { ms: 700 });
      await toBase(c, 1, true);
      await sleep(3000);
    },
  },

  "dm-flip": {
    app: "obsidian",
    caption: ["4. How close is the call?", "Flips at is the weight where a different apartment would win. When it sits close to the weight you set, the decision hangs on it."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true, bars: true });
      await view(c, DECISION, { zoom: 1.1 });
      await toBase(c);
      await blur(c);
      await c.hand.show(1000, 200);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(900);
      const flips = await c.obs((sel) => {
        const heads = [...document.querySelectorAll(`${sel} .dmv-head-btn`)].map((b) => b.textContent);
        const i = heads.indexOf("commute");
        const el = document.querySelectorAll(`${sel} .dmv-flip`)[i];
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }, M);
      await c.box(flips, 4);
      await hand.move(flips.cx + 40, flips.cy + 30, { ms: 800 });
      await sleep(1800);
      await c.clearBoxes();
      await hand.click(await need(page, weightBox("commute")));
      await sleep(300);
      for (let i = 0; i < 4; i++) { await hand.press("ArrowDown", "↓"); await sleep(750); }
      await sleep(400);
      // The rows take their new ranks once the pointer leaves the table.
      await blur(c);
      await hand.move(1150, 180, { ms: 700 });
      await sleep(1200);
      await c.box(await need(page, `${M} .dmv-lead`), 4);
      await sleep(2200);
      await c.clearBoxes();
    },
  },

  "dm-breakdown": {
    app: "obsidian",
    caption: ["Breakdown", "Each bar splits into what every criterion adds or takes away. The negative weights pull to the left of zero."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true, bars: true });
      await view(c, DECISION, { zoom: 1.1 });
      await toBase(c, 1);
      await blur(c);
      await c.hand.show(1000, 200);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(600);
      await hand.click(await need(page, `${R} .dmv-seg-btn`, "Breakdown"));
      await sleep(1500);
      await blur(c);
      await hand.move(1150, 180, { ms: 700 });
      await sleep(3200);
    },
  },

  "dm-blank": {
    app: "obsidian",
    caption: ["Blanks", "A blank scores as the middle of the others, so it neither helps nor hurts. It shows dimmed and is never written to the note."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true, bars: true });
      await view(c, DECISION, { zoom: 1.1 });
      await toBase(c);
      await blur(c);
      await c.hand.show(1000, 200);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(900);
      const cell = await need(page, cellBox("light", "Downtown studio"));
      await c.box(cell, 4);
      await hand.move(cell.cx + 50, cell.cy + 40, { ms: 800 });
      await sleep(2200);
      await c.clearBoxes();
      await retype(c, cell, "4");
      await sleep(900);
      await blur(c);
      await hand.move(1150, 180, { ms: 700 });
      await sleep(2000);
    },
  },

  "dm-add": {
    app: "obsidian",
    caption: ["Add a criterion", "New criteria go in from the table too. Each value is written into that apartment's scores Frame."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true, bars: true });
      await view(c, DECISION, { zoom: 1.1 });
      await toBase(c);
      await blur(c);
      await c.hand.show(700, 450);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(800);
      await hand.click(await need(page, `${M} .dmv-text-btn`, "Add criterion"));
      await sleep(400);
      await hand.type("parking", { cps: 10 });
      await hand.press("Enter");
      await sleep(1400);
      const order = await c.obs((sel) => [...document.querySelectorAll(`${sel} .dmv-row .dmv-td-option`)].map((e) => e.textContent), M);
      const spots = { "Maple St loft": "0", "Harbor View 4B": "1", "Elm Court garden": "2", "Downtown studio": "0" };
      const first = await need(page, cellBox("parking", order[0]));
      await hand.click(first);
      // Off the cell, so its tooltip stays away while the column fills.
      await hand.move(first.cx + 90, first.cy + 150, { ms: 500 });
      await sleep(200);
      for (const name of order) {
        await hand.type(spots[name], { cps: 6 });
        await sleep(200);
        await hand.press("Enter");
        await sleep(450);
      }
      await blur(c);
      await hand.move(1150, 180, { ms: 700 });
      await sleep(2200);
    },
  },

  "dm-result": {
    app: "obsidian",
    caption: ["Write the result", "The ranking saves as a result Frame on the decision note, where other notes, queries and Solenoid can read it."],
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true, bars: true });
      await view(c, DECISION, { zoom: 1.1 });
      await toBase(c);
      await blur(c);
      await c.hand.show(1000, 200);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(800);
      await hand.click(await need(page, `${M} .dmv-toolbar > .dmv-icon-btn`));
      await sleep(500);
      await hand.click(await menuItem(c, "Write result to properties"));
      await sleep(1200);
      await c.obs(() => window.app.workspace.getLeavesOfType("markdown")[0].view.editor.cm.scrollDOM.scrollTo({ top: 0, behavior: "smooth" }));
      await sleep(900);
      const result = await need(page, chip("result"));
      await c.box(await need(page, '.metadata-property[data-property-key="result"]'), 4);
      await sleep(1200);
      await c.clearBoxes();
      await hand.click(result);
      await sleep(3200);
      await hand.click(await need(page, "button", "Cancel"));
      await sleep(600);
    },
  },

  "dm-outro": {
    app: "obsidian",
    async setup(c) {
      await stage(c, { scored: APARTMENTS.map((a) => a.name), decision: true, weights: WEIGHTS, rankings: true, bars: true });
      await view(c, DECISION, { reading: true, zoom: 1.1 });
      await toBase(c);
    },
    async act(c) { await c.sleep(6200); },
  },
};
