// [[C121]]
// Write a formula, 15.5 s: the same order total built twice. In the spreadsheet the formula is typed with cell
// addresses, each reference boxed in its color as it is typed. In Solenoid it is typed with names, a socket
// appearing for each, and then each input is wired to its name; the total lands once the last one is in.
// Capture: scenes/formula.json.
import { compare } from "./kit.js";

export const fps = 60;
export const duration = 15.5;

export function setup(player) {
  const names = player.data.states.map((s) => s.name);
  const typed = names.filter((n) => /^g\d+$/.test(n) && n !== "g0");
  const sheetTyped = player.data.sheetStates.filter((n) => /^x\d+$/.test(n) && n !== "x0");

  const sheetSteps = [
    { t: 1.1, at: "B4", click: true, caption: "Select the cell for the total." },
    { t: 1.8, caption: "Type the formula with cell addresses." },
    ...sheetTyped.map((state, i) => ({ t: 1.8 + i * 0.2, state })),
    { t: 4.9, state: "xdone", caption: "Press Enter." },
  ];
  const fx = (h) => h.card("Order total", 0.55, 0.2);
  const graphSteps = [
    { t: 6.9, at: fx, click: true, caption: "Type the formula with names.", frame: (h) => h.box("Order total") },
    ...typed.map((state, i) => ({ t: 7.3 + i * 0.12, state })),
    { t: 9.9, caption: "Wire each input to its name.", frame: (h) => h.box("Unit price", "Discount", "Order total") },
  ];
  // each wire is a drag: press on the input's output socket, release on the total's socket
  [["Unit price", "w1"], ["Quantity", "w2"], ["Discount", "w3"]].forEach(([from, state], i) => {
    const t = 10.5 + i * 0.75;
    graphSteps.push({ t: t - 0.42, at: (h) => h.end(from, "Order total", 0), click: true });
    graphSteps.push({ t, state, at: (h) => h.end(from, "Order total", 1) });
  });

  return compare(player, {
    headline: "Write a formula",
    kicker: "The formula uses names, and each name is wired to the card it reads.",
    duration, end: 13.0,
    sheet: { from: 0.5, to: 5.9, steps: sheetSteps },
    graph: { from: 6.3, to: 12.9, steps: graphSteps },
  });
}
