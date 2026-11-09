// [[C121]]
// Add a row, 15 s: a sixth order goes into the table. In the spreadsheet it lands in the row under the last
// one, and the total keeps reading 1240: its SUM range ends a row above. In Solenoid the row is added in the
// table, whose column sums count it at once, and on Save the total follows down the cables: 1420.
// Capture: scenes/add-row.json.
import { compare } from "./kit.js";

export const fps = 60;
export const duration = 15;

export function setup(player) {
  return compare(player, {
    headline: "Add a row",
    kicker: "A table's columns hold every row, so totals include new orders.",
    duration, end: 12.6,
    sheet: {
      from: 0.5, to: 6.6, steps: [
        { t: 1.1, at: "A7", click: true, caption: "Add an order below the last one." },
        { t: 1.5, state: "z1" },
        { t: 2.0, state: "z2", at: "B7" },
        { t: 2.5, state: "z3", at: "C7" },
        { t: 3.0, state: "z4", at: "D7" },
        { t: 3.8, at: "D8", caption: "The total still reads 1240." },
        { t: 4.6, state: "z5", click: true, caption: "Its range stops at row 6." },
        { t: 6.2, state: "z6" },
      ],
    },
    graph: {
      from: 7.0, to: 12.4,
      box: (h) => {
        const bs = Object.values(player.cards).filter((g) => g.userData.title !== "Spreadsheet").map((g) => g.userData.box);
        const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
        return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
      },
      // the cards behind the open table keep the old rows until Save
      view: (card, name) => (name === "r2" && card !== "Orders (table)" ? "r1" : name),
      steps: [
        { t: 7.6, at: (h) => h.text("Orders", "[5", "r0"), click: true, caption: "Open the table." },
        { t: 7.7, state: "r1", frame: (h) => h.box("Orders (table)") },
        { t: 8.6, caption: "Add the order as a new row." },
        { t: 9.1, state: "r2", at: (h) => h.text("Orders (table)", "Mirror", "r2") },
        { t: 10.1, at: (h) => h.text("Orders (table)", "Save", "r2"), click: true, caption: "Save. The total follows." },
        { t: 10.2, state: "r3", frame: (h) => h.box("Orders", "Line totals", "Grand total") },
      ],
    },
  });
}
