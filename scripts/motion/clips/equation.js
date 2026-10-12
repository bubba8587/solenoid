// [[C121]]
// Equation, 9 s, straight on: Distance and Time sliders and a "d = s * t" Equation card assemble and wire up, then
// Time slides 1.0 → 3.0 h through the app's own states. Each step shows on the slider, runs down its cable,
// and the Equation solves for the unwired s a beat later (120 → 40 km/h). Capture: scenes/equation.json.
import { assemble, causal, drawCable, enter, front, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 9;

export function setup({ THREE, data, cards, pieces, cables }) {
  ["Distance (km)", "Time (h)", "Find the speed"].forEach((title, i) => assemble(THREE, cards[title], 0.1 + i * 0.25, { flat: true, wave: 0.6, piece: 0.4 }));
  const names = data.states.map((s) => s.name);
  const stepAt = stepper(names, { times: names.slice(1).map((_, i) => 3.0 + (3.6 * (i + 1)) / (names.length - 1)) });
  const flow = causal({ cards, cables, pieces, stepAt });

  const all = data.states[data.states.length - 1].box;
  const tb = cards["Time (h)"].userData.box, eb = cards["Find the speed"].userData.box;
  const action = { x: tb.x, y: eb.y, w: eb.x + eb.w - tb.x, h: tb.y + tb.h - eb.y };
  const shotAt = rig(THREE, [
    [0.0, ...front(THREE, all, { tilt: 7, margin: 1.02 })],
    [2.4, ...front(THREE, all, { tilt: 5, margin: 1.05 })],
    [3.4, ...front(THREE, action, { tilt: 4, margin: 1.1 })],
    [6.6, ...front(THREE, action, { tilt: 3, margin: 1.08 })],
    [7.8, ...front(THREE, all)],
    [duration, ...front(THREE, all)],
  ]);

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, (m) => flow.stateFor(m, t), t);
    cables.forEach((c, i) => drawCable(c, t, 2.0 + i * 0.2, 0.5));
    flow.pulse(t);
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stepAt(t).name) };
}
