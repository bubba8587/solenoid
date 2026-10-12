// [[C121]]
// Order total, 10 s, straight on: the graph assembles blank (every value 0), the cables draw, then 250 is typed
// into Unit price a key at a time and 4 into Quantity; each change shows on its card, runs down the cable, and
// lands on Order total a beat later (850 once both are in). Then the Discount slider sweeps 0.15 → 0.40 and the
// total follows each step. Every frame of every card is the app's own layout. Capture: scenes/order-total.json.
import { assemble, causal, drawCable, enter, front, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 10;

export function setup({ THREE, data, cards, pieces, cables }) {
  const titles = ["Unit price", "Quantity", "Discount", "Order total"];
  titles.forEach((title, i) => assemble(THREE, cards[title], 0.1 + i * 0.16, { flat: true, wave: 0.5, piece: 0.4, glyphSweep: 0.15 }));
  const names = data.states.map((s) => s.name);
  const sweep = names.filter((n) => n.startsWith("d"));
  // keystrokes, then the slider: one start time per state after the first
  const times = [2.3, 2.48, 2.7, 3.55];
  sweep.forEach((_, i) => times.push(4.6 + (3.0 * (i + 1)) / sweep.length));
  const stepAt = stepper(names, { times });
  const flow = causal({ cards, cables, pieces, stepAt });

  const box = (...ts) => {
    const bs = ts.map((t) => cards[t].userData.box);
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  };
  const all = data.states[data.states.length - 1].box;
  const shotAt = rig(THREE, [
    [0.0, ...front(THREE, all, { tilt: 9, margin: 1.02 })],
    [2.0, ...front(THREE, all, { tilt: 7, margin: 1.06 })],
    [2.9, ...front(THREE, box("Unit price", "Quantity", "Order total"), { tilt: 6, margin: 1.12 })],
    [4.3, ...front(THREE, box("Quantity", "Order total"), { tilt: 5, margin: 1.2 })],
    [6.2, ...front(THREE, box("Discount", "Order total"), { tilt: 5, margin: 1.12 })],
    [8.3, ...front(THREE, all)],
    [duration, ...front(THREE, all)],
  ]);

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, (m) => flow.stateFor(m, t), t);
    cables.forEach((c, i) => drawCable(c, t, 1.25 + i * 0.12, 0.5));
    flow.pulse(t);
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stepAt(t).name) };
}
