// [[B3]] sameNodeEverywhere, [[C107]] obsidianPlugin, [[D87]] knapNotes, [[C114]] cardsView
// The What's New cut for Solenoid Properties 0.1.5: one note, filmed in Obsidian. The two new features are typed into
// it as a list; a Frame property is edited in its popup; the same Frame is referenced in the body with Knap and edited
// from there; more Knap renders in Live Preview, its totals held against the Frame's; the `knap` switch turns it off
// and on; a crew Frame on a phone goes from Grid to Cards; the finished note in sixteen looks closes it.
import fs from "node:fs";
import Papa from "papaparse";
import YAML from "yaml";
import { noteOnly } from "./obsidian.mjs";
import { injectCursor } from "./rig.mjs";
import { need, openNote, closeOtherWindows } from "./roundtrip.mjs";
import { look, obsZoom } from "./plugin.mjs";

export const WN_NOTE = "New in Solenoid Properties.md";
const FRONTMATTER = [
  "---", "knap: true", "orders:",
  "  - item: Hinges", "    qty: 12", "    cost: 3.5",
  "  - item: Brackets", "    qty: 8", "    cost: 6",
  "---", "",
].join("\n");
const ZOOM = 1.25;

/** Every visible match of sel in the page or its shadow roots, in document order. */
const rectsIn = (page, sel) => page.evaluate((s) => {
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

/** The live-preview line that holds `text`. */
const editorLine = (c, text) => c.obs((t) => {
  const line = [...document.querySelectorAll(".markdown-source-view .cm-line")].find((l) => l.textContent.includes(t));
  const r = line?.getBoundingClientRect();
  return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, text);

/** The cursor at the end of the note, as a click past the last line leaves it. */
const toEnd = (c) => c.obs(() => {
  const e = window.app.workspace.getLeavesOfType("markdown")[0].view.editor;
  const last = e.lastLine();
  e.setCursor({ line: last, ch: e.getLine(last).length });
  e.focus();
});

const CREW_NOTE = "Crew.md";
const CREW_COLS = ["First Name", "Last Name", "Photo", "Team", "Skills", "Favorite Color", "Project Start", "Project End", "Rating", "Goal Progress", "Sales YTD", "City", "Bio"];
/** The demo vault's crew table as a `crew` Frame property: a picture, name, team, skills, dates, stars and a bar per row. */
function crewNote() {
  const { data } = Papa.parse(fs.readFileSync(new URL("../../demo-vault/Data/crew.csv", import.meta.url), "utf8").trim(), { header: true });
  const cell = (v) => (v === "" ? null : v === "TRUE" ? true : v === "FALSE" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
  const crew = data.map((row) => Object.fromEntries(CREW_COLS.map((k) => [k, cell(row[k])])));
  return `---\n${YAML.stringify({ crew }, { lineWidth: 0 })}---\n\nThe crew for the autumn build.\n`;
}
// A phone-sized window centered on the screen, in the window's CSS px (the screen is 1280x720 of them).
const PHONE = { x: 468, y: 0, width: 344, height: 720 };

const PROP_CHIP = '.metadata-property[data-property-key="orders"] .solenoid-property-chip';
const BODY_CHIP = ".markdown-source-view .solenoid-knap-chip .solenoid-property-chip";
const KNAP_BOX = '.metadata-property[data-property-key="knap"] input[type="checkbox"]';

const CALLOUT = "Knap reads this note's properties: the loop lists each order, and the last line counts them and totals the parts.";

/** The note as it stands after `upTo` scenes, so any scene can be recorded alone. */
const BODY = {
  typed: "1. in-line **Solenoid Properties** objects\n2. in-line {{Knap}} variable rendering\n",
  ref: "\nOrders: {{ orders }}\n",
  knap: "\n> [!note] Using [knap.md](https://knap.md)\n> " + CALLOUT + "\n\n{% for o in orders %}\n- {{ o.qty }} x {{ o.item }} at {{ o.cost | number_format:2 }}\n{% endfor %}\n\n{{ orders | length }} orders, {{ orders | map:\"qty\" | sum }} parts.\n",
};
const ROWS = {
  start: null,
  framed: [["Hinges", 12, 3.5], ["Brackets", 8, 6], ["Screws", 40, 0.2]],
  edited: [["Hinges", 24, 3.5], ["Brackets", 8, 6], ["Screws", 40, 0.2]],
};

async function writeNote(c, parts, rows) {
  await c.obs(async (file, fm, body, r) => {
    const app = window.app;
    app.metadataTypeManager.setType("orders", "solenoid-frame");
    let text = fm + body;
    if (r) text = text.replace(/orders:\n[\s\S]*?---/, `orders:\n${r.map(([i, q, k]) => `  - item: ${i}\n    qty: ${q}\n    cost: ${k}\n`).join("")}---`);
    const f = app.vault.getAbstractFileByPath(file);
    if (f) await app.vault.modify(f, text);
    else await app.vault.create(file, text);
  }, WN_NOTE, FRONTMATTER, parts.map((p) => BODY[p]).join(""), rows);
  await c.sleep(400);
}

/** The note alone in Obsidian with the plugin's look on, in live preview unless `reading`. */
async function noteView(c, { reading = false, zoom = ZOOM } = {}) {
  await closeOtherWindows(c);
  await noteOnly(c.page);
  await obsZoom(c, zoom);
  await look(c);
  await c.obs(() => {
    const app = window.app;
    app.vault.setConfig("autoPairBrackets", false);
    app.vault.setConfig("autoPairMarkdown", false);
    for (const leaf of app.workspace.getLeavesOfType("markdown").slice(1)) leaf.detach();
  });
  await openNote(c, WN_NOTE, { reading });
}

export const WHATSNEW = {
  "wn-intro": {
    app: "obsidian",
    fresh: true,
    async setup(c) {
      await writeNote(c, ["typed", "ref", "knap"], ROWS.edited);
      await noteView(c, { reading: true });
    },
    async act(c) { await c.sleep(5200); },
  },

  "wn-type": {
    app: "obsidian",
    async setup(c) {
      await writeNote(c, [], ROWS.start);
      await noteView(c);
      await c.hand.show(900, 520);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(700);
      const add = await need(c.page, ".metadata-add-button");
      await hand.click({ x: add.x + 40, y: add.y + add.h + 60 });
      await toEnd(c);
      await hand.move(add.x + 560, add.y + add.h + 150, { ms: 600 });
      await sleep(200);
      await hand.type("1. in-line **Solenoid Properties** objects", { cps: 36 });
      await sleep(250);
      await hand.press("Enter");
      await sleep(250);
      await hand.type("in-line {{Knap}} variable rendering", { cps: 36 });
      await sleep(2200);
    },
  },

  "wn-frame": {
    app: "obsidian",
    caption: ["Frame properties", "Solenoid Properties lets you store data objects in your frontmatter and makes them easy to edit."],
    async setup(c) {
      await writeNote(c, ["typed"], ROWS.start);
      await noteView(c);
      await c.hand.show(900, 520);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(700);
      await hand.click(await need(page, PROP_CHIP));
      await sleep(900);
      // Narrower from the corner grip, and tall enough for the added row above the footer.
      const grip = await need(page, ".sol-popup__resize");
      await hand.drag({ x: grip.cx, y: grip.cy }, { x: grip.cx - 130, y: grip.cy + 40 }, { ms: 900 });
      await sleep(500);
      await hand.click(await need(page, 'button[aria-label="Insert"]'));
      await sleep(250);
      await hand.click(await need(page, '[role="menu"] button', "Row below"));
      await sleep(500);
      const cells = await rectsIn(page, "td.table-popup__cell");
      const row = cells.slice(-3);
      for (const [i, text] of ["Screws", "40", "0.2"].entries()) {
        await hand.click(row[i]);
        await sleep(150);
        await hand.type(text, { cps: 30 });
        await sleep(150);
        await hand.press("Enter");
        await sleep(200);
      }
      await sleep(500);
      await hand.click(await need(page, "button", "Save"));
      await sleep(900);
      await c.box(await need(page, '.metadata-property[data-property-key="orders"]'), 4);
      await sleep(1500);
      await c.clearBoxes();
    },
  },

  "wn-ref": {
    app: "obsidian",
    caption: ["Knap references", "Now you can put your Solenoid Properties in the body of your notes using Knap syntax."],
    async setup(c) {
      await writeNote(c, ["typed"], ROWS.framed);
      await noteView(c);
      await c.hand.show(900, 560);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(700);
      const last = await editorLine(c, "variable rendering");
      await hand.click({ x: last.x + last.w - 30, y: last.cy + last.h * 1.2 });
      await toEnd(c);
      await sleep(250);
      await hand.press("Enter");
      await hand.type("Orders: {{ orders }}", { cps: 34 });
      await sleep(300);
      await hand.press("Enter");
      await sleep(900);
      const chip = await need(page, BODY_CHIP);
      await c.box(chip, 4);
      await sleep(900);
      await c.clearBoxes();
      await hand.click(chip);
      await sleep(900);
      // Hinges' qty, 12 to 24.
      const cells = await rectsIn(page, "td.table-popup__cell");
      await hand.click(cells[1]);
      await sleep(150);
      await hand.chord("Control", "a");
      await hand.type("24", { cps: 26 });
      await hand.press("Enter");
      await sleep(400);
      await hand.click(await need(page, "button", "Save"));
      await sleep(1000);
      // The frontmatter holds the edit: both chips are the one property.
      await c.box(await need(page, PROP_CHIP), 4);
      await c.box(await need(page, BODY_CHIP), 4);
      await sleep(1100);
      await c.clearBoxes();
      await hand.click(await need(page, PROP_CHIP));
      await sleep(900);
      const again = await rectsIn(page, "td.table-popup__cell");
      await c.box(again[1], 3);
      await hand.move(again[1].cx + 60, again[1].cy + 40, { ms: 700 });
      await sleep(1600);
      await c.clearBoxes();
      await hand.click(await need(page, "button", "Cancel"));
      await sleep(900);
    },
  },

  "wn-knap": {
    app: "obsidian",
    caption: ["Knap notes", "Other Knap syntax works too. The knap property switches it on for the note."],
    async setup(c) {
      await writeNote(c, ["typed", "ref"], ROWS.edited);
      await noteView(c);
      await c.hand.show(900, 560);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(600);
      await c.obs(() => window.app.workspace.getLeavesOfType("markdown")[0].view.editor.scrollTo(0, 260));
      await sleep(500);
      const last = await editorLine(c, "Orders:");
      await hand.click({ x: last.x + last.w - 30, y: last.cy + last.h * 1.2 });
      await toEnd(c);
      await hand.move(last.x + last.w - 60, last.y - 60, { ms: 500 });
      await sleep(250);
      // What the Knap below does, as a callout. Enter continues the callout; a second Enter leaves it.
      await hand.press("Enter");
      await hand.type("> [!note] Using [knap.md](https://knap.md)", { cps: 40 });
      await hand.press("Enter");
      await hand.type(CALLOUT, { cps: 55 });
      await hand.press("Enter");
      await hand.press("Enter");
      // Up, so the Knap is typed clear of the caption.
      await c.obs(() => window.app.workspace.getLeavesOfType("markdown")[0].view.editor.cm.scrollDOM.scrollTo({ top: 500, behavior: "smooth" }));
      await hand.move(1180, 300, { ms: 600 });
      await sleep(200);
      await hand.press("Enter");
      await hand.type("{% for o in orders %}", { cps: 36 });
      await hand.press("Enter");
      await hand.type("- {{ o.qty }} x {{ o.item }} at {{ o.cost | number_format:2 }}", { cps: 40 });
      await hand.press("Enter");
      await hand.press("Enter");
      await hand.type("{% endfor %}", { cps: 36 });
      await hand.press("Enter");
      await hand.press("Enter");
      await hand.type("{{ orders | length }} orders, {{ orders | map:\"qty\" | sum }} parts.", { cps: 40 });
      await hand.press("Enter");
      await sleep(1400);
      // What Knap made of the orders, then the orders it read, then the result again.
      const out = [...await rectsIn(page, ".markdown-source-view .solenoid-knap-block"), await editorLine(c, "parts.")];
      for (const r of out) await c.box(r, 4);
      await hand.move(out[1].x + out[1].w + 80, out[1].cy, { ms: 700 });
      await sleep(2000);
      await c.clearBoxes();
      await hand.click(await need(page, BODY_CHIP));
      await sleep(900);
      const cells = await rectsIn(page, "td.table-popup__cell");
      for (const i of [1, 4, 7]) await c.box(cells[i], 3);
      await c.box((await rectsIn(page, ".table-popup__statvalue"))[1], 5);
      await hand.move(cells[7].cx + 60, cells[7].cy + 70, { ms: 700 });
      await sleep(2600);
      await c.clearBoxes();
      await hand.click(await need(page, "button", "Cancel"));
      await sleep(600);
      for (const r of out) await c.box(r, 4);
      await sleep(1800);
      await c.clearBoxes();
    },
  },

  "wn-switch": {
    app: "obsidian",
    async setup(c) {
      await writeNote(c, ["typed", "ref", "knap"], ROWS.edited);
      await noteView(c);
      await c.obs(() => window.app.workspace.getLeavesOfType("markdown")[0].view.editor.scrollTo(0, 120));
      await c.hand.show(900, 400);
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(700);
      // The switch: off shows the template, on renders it again.
      const box = await need(page, KNAP_BOX);
      await hand.click(box);
      await sleep(1700);
      await hand.click(box);
      await sleep(1400);
      // Down through the note: each piece shows its source while the cursor is in it.
      const first = await editorLine(c, "Solenoid Properties");
      await hand.click({ x: first.x + 4, y: first.cy });
      await sleep(300);
      await hand.hide();
      const walk = ["ArrowDown", "ArrowDown", "ArrowDown", "End", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"];
      for (const key of walk) {
        await hand.press(key, key === "End" ? "End" : "↓");
        await sleep(620);
      }
      await sleep(1200);
    },
  },

  "wn-cards": {
    app: "obsidian",
    caption: ["Cards view", "A Frame's popup lays each row out as a card. Every column finds its place by its name, type and contents."],
    async setup(c) {
      await c.obs(async (file, text) => {
        const app = window.app;
        app.metadataTypeManager.setType("crew", "solenoid-frame");
        const f = app.vault.getAbstractFileByPath(file);
        if (f) await app.vault.modify(f, text);
        else await app.vault.create(file, text);
      }, CREW_NOTE, crewNote());
      await closeOtherWindows(c);
      await noteOnly(c.page);
      await obsZoom(c, 1);
      await look(c);
      await c.obs((b) => {
        window.electron.remote.getCurrentWindow().setBounds(b);
        if (!window.app.isMobile) window.app.emulateMobile(true);
      }, PHONE);
      // Entering the emulation reloads Obsidian, and the kit with it.
      await c.sleep(4000);
      await injectCursor(c.page);
      await noteOnly(c.page);
      await openNote(c, CREW_NOTE);
      await c.sleep(600);
      // Taps, not a pointer: the rings show where a finger lands.
      await c.hand.hide();
    },
    async act(c) {
      const { hand, sleep, page } = c;
      await sleep(900);
      await hand.click(await need(page, '.metadata-property[data-property-key="crew"] .solenoid-property-chip'));
      await sleep(1300);
      // Swipes; the emulated phone takes no wheel.
      const swipe = (sel, to) => c.obs((s, t) => {
        const roots = [document, ...[...document.querySelectorAll("*")].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
        roots.map((r) => r.querySelector(s)).find(Boolean)?.scrollTo({ ...t, behavior: "smooth" });
      }, sel, to);
      // Across the grid's thirteen columns first, then back.
      const across = await c.obs(() => {
        const roots = [document, ...[...document.querySelectorAll("*")].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
        const el = roots.map((r) => r.querySelector(".table-popup__grid-scroll")).find(Boolean);
        return el.scrollWidth - el.clientWidth;
      });
      for (let x = 260; x < across + 260; x += 260) {
        await swipe(".table-popup__grid-scroll", { left: Math.min(x, across) });
        await sleep(520);
      }
      await sleep(600);
      await swipe(".table-popup__grid-scroll", { left: 0 });
      await sleep(1100);
      await hand.click(await need(page, "button", "Cards"));
      await sleep(1600);
      await swipe(".table-cards-wrap", { top: 900 });
      await sleep(2200);
      await swipe(".table-cards-wrap", { top: 0 });
      await sleep(1100);
      await hand.click(await need(page, ".table-cards__filter input"));
      await sleep(300);
      await hand.type("logic", { cps: 26 });
      await sleep(2600);
    },
    async teardown(c) {
      await c.page.keyboard.press("Escape");
      // Leaving the emulation reloads Obsidian: the pointer is injected again once it is back.
      await c.obs(() => { if (window.app.isMobile) window.app.emulateMobile(false); }).catch(() => {});
      await c.sleep(4000);
      await injectCursor(c.page);
    },
  },

  "wn-grid": {
    app: "obsidian",
    panels: ["obs"],
    hold: 7,
    grid: { cols: 4, title: "Try the Solenoid Properties plugin!" },
    // Every palette, most accents, no pair twice; dark and light alternate like a checkerboard. Equinox keeps its
    // accents near neutral, so it gets one tile.
    states: [
      ["Default", "vermilion", "dark"], ["Orchard", "lime", "light"], ["Blueprint", "amber", "dark"], ["Solarized", "violet", "light"],
      ["Orchard", "teal", "light"], ["Muted", "sky", "dark"], ["Default", "green", "light"], ["Orchard", "purple", "dark"],
      ["Solarized", "teal", "dark"], ["Blueprint", "gold", "light"], ["Blueprint", "pink", "dark"], ["Muted", "amber", "light"],
      ["Blueprint", "violet", "light"], ["Default", "sky", "dark"], ["Solarized", "green", "light"], ["Equinox", "gold", "dark"],
    // The second and fourth columns have the Frame's editor open.
    ].map(([palette, accent, mode], i) => ({ palette, accent, mode, popup: i % 2 === 1 })),
    async setup(c) {
      await writeNote(c, ["typed", "ref", "knap"], ROWS.edited);
      await noteView(c, { reading: true, zoom: 1 });
      await c.obs(async (file) => {
        const app = window.app;
        app.vault.setConfig("showRibbon", true);
        app.workspace.leftSplit.expand();
        app.workspace.rightSplit.expand();
        await app.workspace.getLeavesOfType("file-explorer")[0]?.view.revealInFolder?.(app.vault.getAbstractFileByPath(file));
        // Every property with its type icon, in its type's color.
        const right = app.workspace.getLeavesOfType("all-properties")[0] ?? app.workspace.getRightLeaf(false);
        await right.setViewState({ type: "all-properties", active: true });
        app.workspace.revealLeaf(right);
        app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("markdown")[0], { focus: false });
      }, WN_NOTE);
      await c.sleep(800);
    },
    async apply(c, state) {
      await c.page.keyboard.press("Escape");
      await look(c, state);
      // The top of the note, and the mouse parked where it raises no tooltip.
      await c.obs(() => {
        const el = window.app.workspace.getLeavesOfType("markdown")[0].view.containerEl.querySelector(".markdown-preview-view");
        if (el) el.scrollTop = 0;
      });
      await c.page.mouse.move(600, 12);
      await c.obs(() => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; el?.blur?.(); document.activeElement?.blur?.(); });
      await c.sleep(400);
      if (state.popup) {
        const chip = await need(c.page, PROP_CHIP);
        await c.page.mouse.click(chip.cx, chip.cy);
        await c.sleep(700);
      }
    },
    async teardown(c) {
      await c.page.keyboard.press("Escape");
      await look(c);
    },
  },

  "wn-outro": {
    app: "obsidian",
    async setup(c) {
      await writeNote(c, ["typed", "ref", "knap"], ROWS.edited);
      await noteView(c, { reading: true });
    },
    async act(c) { await c.sleep(6200); },
  },
};
