// [[C121]]
// Ripple, 11 s, straight on: a monthly budget graph with the salary blank, so everything downstream is the
// app's own empty answer. The salary is typed in and the result ripples out a column at a time: take-home,
// then left over, then the savings rate. Then rent climbs 1200 → 2400 and every step cascades the same way,
// spending first, the savings rate last. Capture: scenes/ripple.json.
import { assemble, causal, drawCable, enter, front, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 11;

export function setup({ THREE, data, cards, pieces, cables }) {
  const names = data.states.map((s) => s.name);
  const typed = names.filter((n) => n.startsWith("sal")), rents = names.filter((n) => n.startsWith("r"));
  const times = [2.7, 2.88, 3.05, 3.3];
  rents.forEach((_, i) => times.push(4.6 + (3.4 * (i + 1)) / rents.length));
  const stepAt = stepper(names, { times: times.slice(0, names.length - 1) });
  const flow = causal({ cards, cables, pieces, stepAt, lag: 0.3 });
  // assemble column by column, in cable order
  Object.entries(cards).forEach(([title, g]) => assemble(THREE, g, 0.1 + flow.depth[title] * 0.32 + (g.userData.box.y / 1000) * 0.2, { flat: true, wave: 0.5, piece: 0.38 }));
  const order = [...cables].sort((a, b) => a.userData.ends[0][0] - b.userData.ends[0][0]);

  const all = data.states[data.states.length - 1].box;
  const shotAt = rig(THREE, [
    [0.0, ...front(THREE, all, { tilt: 6, margin: 1.0 })],
    [2.3, ...front(THREE, all, { tilt: 5, margin: 1.02 })],
    [4.4, ...front(THREE, all, { tilt: 4, margin: 0.98 })],
    [8.2, ...front(THREE, all, { tilt: 2, margin: 0.96 })],
    [9.6, ...front(THREE, all)],
    [duration, ...front(THREE, all)],
  ]);

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, (m) => flow.stateFor(m, t), t);
    order.forEach((c, i) => drawCable(c, t, 1.5 + i * 0.09, 0.45));
    flow.pulse(t);
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stepAt(t).name) };
}
