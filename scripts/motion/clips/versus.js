// [[C121]]
// Versus, 10 s, straight on: a spreadsheet works out an order total, its logic a string in the formula bar.
// The graph beside it does the same sum with the formula on the card and the inputs wired in. Then the
// discount climbs 15% → 40%: in the sheet two cells flip at once with nothing to show why; in the graph the
// change leaves the slider, runs down the cable and lands on the total a beat later. Capture: scenes/versus.json.
import { assemble, causal, drawCable, enter, front, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 10;

export function setup({ THREE, data, cards, pieces, cables }) {
  assemble(THREE, cards.Spreadsheet, 0.05, { flat: true, wave: 0.45, piece: 0.35, glyphSweep: 0.2 });
  ["Unit price", "Quantity", "Discount", "Order total"].forEach((title, i) => assemble(THREE, cards[title], 2.25 + i * 0.14, { flat: true, wave: 0.45, piece: 0.38, glyphSweep: 0.15 }));
  const names = data.states.map((s) => s.name);
  const stepAt = stepper(names, { times: names.slice(1).map((_, i) => 4.4 + (3.0 * (i + 1)) / (names.length - 1)) });
  const flow = causal({ cards, cables, pieces, stepAt });

  const union = (...bs) => {
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  };
  const sheet = cards.Spreadsheet.userData.box, graph = data.states[data.states.length - 1].box;
  const both = union(sheet, graph);
  const shotAt = rig(THREE, [
    [0.0, ...front(THREE, sheet, { tilt: 6, margin: 1.5 })],
    [2.1, ...front(THREE, sheet, { tilt: 5, margin: 1.35 })],
    [3.7, ...front(THREE, both, { tilt: 4, margin: 1.04 })],
    [7.6, ...front(THREE, both, { tilt: 2, margin: 1.0 })],
    [9.0, ...front(THREE, both, { margin: 1.02 })],
    [duration, ...front(THREE, both, { margin: 1.02 })],
  ]);

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, (m) => flow.stateFor(m, t), t);
    cables.forEach((c, i) => drawCable(c, t, 3.2 + i * 0.12, 0.5));
    flow.pulse(t);
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stepAt(t).name) };
}
