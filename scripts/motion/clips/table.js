// [[C121]]
// Table, 9 s, straight on: an Orders frame, a Line totals column and a Grand total assemble and wire up, then the
// Chair quantity climbs 4 → 10 one order at a time. Each edit shows in the cell, runs down the cables and
// reaches the total a beat after it reaches the column (1420 → 1930). Capture: scenes/table.json.
import { assemble, causal, drawCable, enter, front, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 9;

export function setup({ THREE, data, cards, pieces, cables }) {
  ["Orders", "Line totals", "Grand total"].forEach((title, i) => assemble(THREE, cards[title], 0.1 + i * 0.3, { flat: true, wave: 0.6, piece: 0.4 }));
  const names = data.states.map((s) => s.name);
  const stepAt = stepper(names, { times: names.slice(1).map((_, i) => 3.3 + i * 0.55) });
  const flow = causal({ cards, cables, pieces, stepAt });

  const all = data.states[data.states.length - 1].box;
  const shotAt = rig(THREE, [
    [0.0, ...front(THREE, all, { tilt: 7, margin: 1.02 })],
    [2.4, ...front(THREE, all, { tilt: 5, margin: 1.06 })],
    [6.6, ...front(THREE, all, { tilt: 3, margin: 0.98 })],
    [7.8, ...front(THREE, all)],
    [duration, ...front(THREE, all)],
  ]);

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, (m) => flow.stateFor(m, t), t);
    cables.forEach((c, i) => drawCable(c, t, 2.0 + i * 0.25, 0.5));
    flow.pulse(t);
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stepAt(t).name) };
}
