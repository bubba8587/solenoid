// [[C121]]
// Find the mistake, 14 s: "4 units" was typed where a quantity goes. In the spreadsheet the total reads #VALUE!
// and each cell its formula uses is checked until the text turns up. In Solenoid #VALUE! shows on the Quantity
// card itself; retyping it sends the fix down the cable to the total. Capture: scenes/mistake.json.
import { compare } from "./kit.js";

export const fps = 60;
export const duration = 14;

export function setup(player) {
  return compare(player, {
    headline: "Find the mistake",
    kicker: "An error shows on the card where it starts.",
    duration, end: 11.4,
    sheet: {
      from: 0.5, to: 6.6, steps: [
        { t: 1.1, at: "B4", click: true, caption: "The total reads #VALUE!." },
        { t: 2.1, state: "k1", caption: "Check each cell its formula uses." },
        { t: 3.0, state: "k2", at: "B1", click: true },
        { t: 3.8, state: "k3", at: "B2", click: true, caption: "Quantity holds text." },
        { t: 5.0, state: "k4", caption: "Retype it." },
      ],
    },
    graph: {
      from: 7.0, to: 11.2, steps: [
        { t: 7.6, at: (h) => h.text("Quantity", "#VALUE!", "m0"), caption: "#VALUE! shows on Quantity.", frame: (h) => h.box("Quantity", "Order total") },
        { t: 8.9, at: (h) => h.card("Quantity", 0.5, 0.42), click: true, caption: "Retype it." },
        { t: 9.0, state: "m1" },
        { t: 9.35, state: "m2" },
      ],
    },
  });
}
