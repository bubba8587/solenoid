// [[B3]] sameNodeEverywhere
// Each scene builds a real document off camera (save-format JSON or a shipped example), then acts on camera.
// Captions follow DESIGN.md § Voice; compose.mjs's ORDER is the running order.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./rig.mjs";
import { ROUNDTRIP } from "./roundtrip.mjs";

const num = (id, label, value, x, y) => ({ id, type: "NumberInputNode", x, y, init: { label, value } });
const fc = (id, host, key, unit, x, y, extra = {}) => ({
  id, type: "FormatControllerNode", x, y,
  init: { label: "Format", hostNodeId: host, socketKey: key, side: "output", unit, socketDataType: "number", ...extra },
});
const money = (id, host, key, x, y, places = 0) =>
  fc(id, host, key, "usd", x, y, { format: "decimal", decimalDigits: places, decimalMode: "places" });
const wire = (source, sourceOutput, target, targetInput) => ({ source, sourceOutput, target, targetInput });
const csv = (name) => fs.readFileSync(path.join(ROOT, "scripts", "demo-video", "data", name), "utf8");

// The demo vault's bank export, spending only: amounts positive, with a Month column for slicing.
function spendingGraph() {
  const MONTH = { "01": "Jan", "02": "Feb", "03": "Mar" };
  const rows = fs.readFileSync(path.join(ROOT, "demo-vault", "Data", "transactions.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const spending = ["Date,Month,Account,Category,Merchant,Amount",
    ...rows.filter((r) => Number(r[4]) < 0).map(([d, a, cat, m, v]) => [d, MONTH[d.slice(5, 7)], a, cat, m, (-Number(v)).toFixed(2)].join(","))].join("\n");
  return {
    v: 2,
    nodes: [
      { id: "spend", type: "FrameInputNode", x: 0, y: 0, init: { label: "Spending", frameText: spending } },
      { id: "slicer", type: "SlicerNode", x: 420, y: 0, init: { label: "Account", selectedColumn: "Account", selectedValues: ["Credit Card"], multiSelect: true } },
      { id: "byCat", type: "GroupByFrameNode", x: 700, y: -80, init: { label: "By category", agg: "sum" }, stringLiterals: { keys: "Category", column: "Amount" } },
      { id: "flows", type: "GroupByFrameNode", x: 700, y: 440, init: { label: "Account to category", agg: "sum" }, stringLiterals: { keys: "Account, Category", column: "Amount" } },
      { id: "treemap", type: "ProportionNode", x: 980, y: -80, init: { label: "Where it went" } },
      { id: "sankey", type: "SankeyNode", x: 980, y: 440, init: { label: "Accounts and categories" }, stringLiterals: { options: "fontsize=13" } },
    ],
    connections: [
      wire("spend", "frame", "slicer", "frame"), wire("slicer", "result", "byCat", "frame"), wire("slicer", "result", "flows", "frame"),
      wire("byCat", "frame", "treemap", "frame"), wire("flows", "frame", "sankey", "frame"),
    ],
  };
}

// Click a field, replace its text, commit with Enter.
async function retype(c, label, text, { sel = "input", at = 0.4 } = {}) {
  const f = await c.within(label, sel);
  await c.hand.click({ x: f.x + f.w * at, y: f.cy });
  await c.sleep(150);
  await c.hand.chord("Control", "a");
  await c.hand.type(text, { cps: 7 });
  await c.sleep(250);
  await c.hand.press("Enter");
}

// Drag a slider's thumb to a fraction of its track.
async function slide(c, label, to, ms = 1400) {
  const track = await c.within(label, 'input[type="range"]');
  const from = await c.demo((l) => {
    const n = [...document.querySelectorAll(".react-flow__node")].find((e) => e.querySelector(".solenoid-node__label-display")?.textContent.trim() === l);
    const r = n.querySelector('input[type="range"]');
    return (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min));
  }, label);
  const pad = 8;
  const x = (t) => track.x + pad + (track.w - 2 * pad) * t;
  await c.hand.drag({ x: x(from), y: track.cy }, { x: x(to), y: track.cy }, { ms, hover: 120 });
}

export const SCENES = {
  // Backdrops for the title cards: a real graph drifting under the blur.
  intro: {
    async setup(c) {
      await c.legend(false);
      await c.example("chart-showcase");
      await c.frame(["Heatmap", "Series frame", "Treemap"], { k: 0.62 });
      await c.hand.hide();
    },
    async act(c) { await c.drift({ dx: 60, dy: -40, zoom: 1.06 }, 6500); },
  },
  outro: {
    async setup(c) {
      await c.legend(false);
      await c.example("getting-started");
      await c.frame(["Budget", "Name badge", "Convert Mi to KM"], { k: 0.7 });
      await c.hand.hide();
    },
    async act(c) { await c.drift({ dx: -50, dy: 30, zoom: 1.05 }, 7000); },
  },

  build: {
    caption: ["Cards and cables", "Press A to add a card at the pointer. Cables take the place of cell references."],
    async setup(c) {
      await c.legend(true);
      await c.doc({
        v: 2,
        nodes: [num("price", "Price", 40, 0, 0), num("units", "Units sold", 250, 0, 144)],
        connections: [],
      }, "Revenue");
      await c.frame({ x: -40, y: -60, w: 700, h: 300 }, { k: 1.3 });
      const p = await c.toScreen(560, 250);
      await c.hand.show(p.x, p.y);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(700);
      const spot = await c.toScreen(336, 40);
      await hand.move(spot.x, spot.y);
      await sleep(250);
      await hand.press("a", "A");
      await sleep(450);
      await hand.type("multiply");
      await sleep(380);
      await hand.press("Enter");
      await sleep(700);
      await hand.drag(await c.socket("Price", "value", "out"), await c.socket("Multiply", "a", "in"));
      await sleep(300);
      await hand.drag(await c.socket("Units sold", "value", "out"), await c.socket("Multiply", "b", "in"));
      await sleep(1000);
      await retype(c, "Price", "45", { at: 0.35 });
      await sleep(300);
      const rest = await c.toScreen(590, 200);
      await hand.move(rest.x, rest.y, { ms: 700 });
      await sleep(1300);
    },
  },

  types: {
    caption: ["Typed sockets and cables", "Sockets and cables are colored by value type, so a date never passes for a number or a piece of text."],
    async setup(c) {
      await c.legend(true);
      await c.doc({
        v: 2,
        nodes: [
          { id: "d", type: "DateInputNode", x: 0, y: 0, init: { label: "Invoice date" }, stringLiterals: { date: "15-Mar-2026" } },
          { id: "t", type: "TextInputNode", x: 0, y: 150, init: { label: "Customer", value: "Acme Corp" } },
          num("n", "Amount", 1200, 0, 300),
          { id: "m", type: "ArithmeticNode", x: 400, y: 110, init: { label: "With tax", op: "mul" }, literals: { a: 0, b: 1.08 } },
        ],
        connections: [],
      }, "Invoice");
      await c.frame({ x: -60, y: -40, w: 700, h: 420 }, { k: 1.3, dy: -58 });
      const p = await c.toScreen(330, 420);
      await c.hand.show(p.x, p.y);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(800);
      await hand.drag(await c.socket("Invoice date", null, "out"), await c.socket("With tax", "a", "in"), { hover: 600 });
      await sleep(400);
      await hand.drag(await c.socket("Customer", null, "out"), await c.socket("With tax", "a", "in"), { hover: 600 });
      await sleep(400);
      await hand.drag(await c.socket("Amount", null, "out"), await c.socket("With tax", "a", "in"), { hover: 250 });
      await sleep(400);
      const rest = await c.toScreen(470, 400);
      await hand.move(rest.x, rest.y, { ms: 800 });
      await sleep(1300);
    },
  },

  units: {
    caption: ["Units", "Values carry real units through the math: SUM(5 km, 3) is 8 km."],
    async setup(c) {
      await c.legend(false);
      await c.doc({
        v: 2,
        nodes: [
          num("len", "Length", 2, 0, 0), fc("lenFc", "len", "value", "m", 181, 18),
          num("wid", "Width", 4, 0, 150), fc("widFc", "wid", "value", "m", 181, 168),
          num("hgt", "Height", 2.5, 0, 300), fc("hgtFc", "hgt", "value", "m", 181, 318),
          { id: "area", type: "ArithmeticNode", x: 420, y: 40, init: { label: "Floor area", op: "mul" }, literals: { a: 0, b: 0 } },
          fc("areaFc", "area", "result", "m2", 601, 100),
          { id: "vol", type: "ArithmeticNode", x: 820, y: 180, init: { label: "Volume", op: "mul" }, literals: { a: 0, b: 0 } },
          fc("volFc", "vol", "result", "m3", 1001, 240),
        ],
        connections: [
          wire("len", "value", "lenFc", "in"), wire("lenFc", "out", "area", "a"),
          wire("wid", "value", "widFc", "in"), wire("widFc", "out", "area", "b"),
          wire("area", "result", "areaFc", "in"), wire("areaFc", "out", "vol", "a"),
          wire("hgt", "value", "hgtFc", "in"), wire("hgtFc", "out", "vol", "b"),
          wire("vol", "result", "volFc", "in"),
        ],
      }, "Room");
      await c.frame({ x: -20, y: -10, w: 1185, h: 400 }, { k: 1.02, dy: -46 });
      const p = await c.toScreen(560, 420);
      await c.hand.show(p.x, p.y);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(1700);
      await retype(c, "Length", "3");
      await sleep(400);
      const rest = await c.toScreen(640, 400);
      await hand.move(rest.x, rest.y, { ms: 900 });
      await sleep(2900);
    },
  },

  formula: {
    caption: ["Excel formulas", "Functions use Excel's names, syntax and math."],
    async setup(c) {
      await c.legend(false);
      await c.doc({
        v: 2,
        nodes: [
          { id: "pay", type: "ExpressionNode", x: 0, y: 0, init: { label: "Monthly payment", expr: "" } },
          money("payFc", "pay", "result", 241, 90, 2),
        ],
        connections: [wire("pay", "result", "payFc", "in")],
      }, "Mortgage");
      await c.frame({ x: -40, y: -30, w: 480, h: 300 }, { k: 1.45, dy: -30 });
      // Opening the formula popup stalls the dev build for seconds, so the take starts with it open.
      const f = await c.within("Monthly payment", ".solenoid-expr__field");
      await c.page.mouse.click(f.x + f.w * 0.3, f.cy);
      await c.sleep(3500);
      const pop = await c.find(".formula-popup");
      await c.hand.show(pop.x + pop.w + 40, pop.y + pop.h + 30);
      await c.sleep(800);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(1100);
      await hand.type("PMT(6.5%/12, 30*12, -350000)", { cps: 14 });
      await sleep(1200);
      await hand.click(await c.find(".formula-popup .sol-popup__close"));
      await sleep(500);
      const rest = await c.toScreen(120, 330);
      await hand.move(rest.x, rest.y, { ms: 700 });
      await sleep(1500);
    },
  },

  triangle: {
    caption: ["Solve for any part", "Give the Triangle Solver any three parts, one of them a side. It works out the rest, area and perimeter included."],
    async setup(c) {
      await c.legend(false);
      await c.doc({
        v: 2,
        nodes: [
          { id: "C", type: "SliderInputNode", x: 0, y: 0, init: { label: "Angle C", value: 60 }, literals: { min: 20, max: 150, step: 1 } },
          num("a", "Side a", 7, 0, 225),
          num("b", "Side b", 5, 0, 330),
          { id: "tri", type: "TriangleSolverNode", x: 290, y: -10, init: { label: "Triangle Solver" } },
        ],
        connections: [wire("a", "value", "tri", "a"), wire("b", "value", "tri", "b"), wire("C", "value", "tri", "C")],
      }, "Triangle");
      await c.frame({ x: -20, y: -20, w: 500, h: 490 }, { k: 1.2, dx: 240, dy: 10 });
      const p = await c.toScreen(160, 300);
      await c.hand.show(p.x, p.y);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(1000);
      await slide(c, "Angle C", 0.88, 1700);
      await sleep(400);
      await slide(c, "Angle C", 0.12, 1800);
      await sleep(350);
      const rest = await c.toScreen(120, 230);
      await hand.move(rest.x, rest.y, { ms: 700 });
      await sleep(1300);
    },
  },

  tables: {
    caption: ["Relational verbs", "Filter, Sort, Join, GROUPBY and Pivot. The desktop build runs them on Rust and Polars, fast enough for million-row tables."],
    async setup(c) {
      await c.legend(false);
      await c.doc({
        v: 2,
        nodes: [
          { id: "orders", type: "FrameInputNode", x: 0, y: 0, init: { label: "Orders", frameText: csv("orders.csv") } },
          { id: "filter", type: "FilterFrameNode", x: 420, y: 0, init: { label: "Filter", condConfig: { 0: { op: "gte" } }, valueKeys: ["frame", "column0", "value0"] }, stringLiterals: { column0: "Revenue", value0: "500" } },
          { id: "group", type: "GroupByFrameNode", x: 740, y: 0, init: { label: "GROUPBY", agg: "sum", totalDepth: 0 }, stringLiterals: { keys: "Region", column: "Revenue" } },
          { id: "chart", type: "ChartNode", x: 1060, y: 0, init: { label: "Revenue by region", op: "column" } },
        ],
        connections: [wire("orders", "frame", "filter", "frame"), wire("filter", "frame", "group", "frame"), wire("group", "frame", "chart", "values")],
      }, "Orders");
      await c.frame(["Orders", "Filter", "GROUPBY", "Revenue by region"], { pad: 0.04, maxK: 1.0, dy: -40 });
      const p = await c.toScreen(560, 560);
      await c.hand.show(p.x, p.y);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(1700);
      const value = await c.demo(async () => {
        const n = await window.__demo.byLabel("Filter");
        const el = (await window.__demo.view()).nodeElement(n.id);
        const input = [...el.querySelectorAll("input")].find((i) => i.value === "500");
        const r = input.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, cy: r.y + r.height / 2 };
      });
      await hand.click({ x: value.x + value.w * 0.35, y: value.cy });
      await sleep(150);
      await hand.chord("Control", "a");
      await hand.type("1500", { cps: 8 });
      await sleep(250);
      await hand.press("Enter");
      await sleep(400);
      const rest = await c.toScreen(900, 560);
      await hand.move(rest.x, rest.y, { ms: 800 });
      await sleep(3300);
    },
  },

  charts: {
    caption: ["Charts", "Treemaps, Sankey diagrams, gauges and heatmaps sit beside the usual charts. A Slicer filters their rows like Excel's."],
    async setup(c) {
      await c.legend(false);
      await c.doc(spendingGraph(), "Household spending");
      await c.frame(["Account", "By category", "Where it went"], { pad: 0.05, maxK: 1.05, dy: -30 });
      const p = await c.toScreen(560, 330);
      await c.hand.show(p.x, p.y);
    },
    async act(c) {
      const { hand, sleep } = c;
      await sleep(1300);
      await hand.click(await c.within("Account", "button", "Checking"));
      await sleep(2100);
      await hand.hide();
      await c.fly(["Account to category", "Accounts and categories"], { pad: 0.05, maxK: 1.3, dy: -10 }, 1700);
      await c.drift({ zoom: 1.04 }, 2600);
    },
  },

  ...ROUNDTRIP,
};
