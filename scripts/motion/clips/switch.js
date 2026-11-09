// [[C121]]
// Switch an input, 13.5 s: the order total moves from the store price to the online price. In the spreadsheet
// the price's address is found inside the formula and retyped. In Solenoid the price cable is moved to the
// Online price card, and the total's socket names its new source. Capture: scenes/switch.json.
import { compare } from "./kit.js";

export const fps = 60;
export const duration = 13.5;

export function setup(player) {
  return compare(player, {
    headline: "Switch an input",
    kicker: "Each input on a card names the card it reads from.",
    duration, end: 11.0,
    sheet: {
      from: 0.5, to: 5.6, steps: [
        { t: 1.1, at: "B4", click: true, caption: "Select the total." },
        { t: 2.0, state: "y1", at: (h) => h.bar(0.08), click: true, caption: "Find the price's address in the formula." },
        { t: 3.4, state: "y2", caption: "Change B1 to B2." },
        { t: 3.7, state: "y3" },
        { t: 4.5, state: "y4", caption: "Press Enter." },
      ],
    },
    graph: {
      from: 6.0, to: 10.8, steps: [
        { t: 6.9, at: (h) => h.end("Online price", "Order total", 0), click: true, caption: "Drag a cable from Online price to the total's price.", frame: (h) => h.box("Store price", "Online price", "Order total") },
        { t: 7.9, state: "online", at: (h) => h.end("Online price", "Order total", 1) },
        { t: 8.9, at: (h) => h.text("Order total", "Online"), caption: "The total now names Online price." },
      ],
    },
  });
}
