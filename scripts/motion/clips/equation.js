// [[C121]]
// Equation, 9 s: Distance and Time sliders and a "d = s * t" Equation card assemble and wire up, then Time slides
// 1.0 → 3.0 h through the app's own states and the Equation solves for the unwired s each step (120 → 40 km/h).
// The camera holds the Time slider in focus as it starts to move, racks across to the solved speed box with a
// shallow lens, and settles straight on. Capture: scenes/equation.json.
import { assemble, drawCable, enter, helpers, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 9;

export function setup({ THREE, data, cards, pieces, cables }) {
  const { V, at, off, final } = helpers(THREE);
  const dist = cards["Distance (km)"], time = cards["Time (h)"], eq = cards["Find the speed"];
  assemble(THREE, dist, 0.1, { wave: 0.8 });
  assemble(THREE, time, 0.45, { wave: 0.8 });
  assemble(THREE, eq, 0.95, { wave: 1.0 });
  const names = data.states.map((s) => s.name);
  const SWEEP = [3.6, 6.9];
  const stateAt = stepper(names, { t0: SWEEP[0], t1: SWEEP[1] });
  const tb = time.userData.box;
  const fromTime = (c) => { const [x, y] = c.userData.ends[0]; return x >= tb.x && x <= tb.x + tb.w + 20 && y >= tb.y && y <= tb.y + tb.h; };

  // the Equation's value boxes top to bottom: d, s, t, check; s is the one it solves
  const boxes = [...new Map(pieces.filter((m) => m.userData.card === eq.userData.title && m.userData.part === "hero" && m.userData.kind === "box" && !m.userData.state)
    .map((m) => [Math.round(m.userData.center[1]), m])).values()].sort((a, b) => a.userData.center[1] - b.userData.center[1]);
  // aim at the number, which sits at the right of its box
  const sBox = boxes[1] ? V(boxes[1].userData.center[0] + boxes[1].userData.size[0] / 2 - 45, -boxes[1].userData.center[1]) : at(eq.userData.box);
  const thumb = at(tb, 0.5, 0.72);
  const ref = data.reference, endBox = data.states[data.states.length - 1].box;
  const shotAt = rig(THREE, [
    [0.0, off(at(dist.userData.box, 0.5, 0.4), -1.0, -2.2, 2.4), at(dist.userData.box, 0.6, 0.45), 30, 1.2],
    [1.8, off(at(ref, 0.45, 0.45), -1.2, -4.0, 4.4), at(ref, 0.5, 0.45), 34, 1.5],
    [3.3, off(thumb, -0.5, -2.2, 2.6), thumb, 50, 1.0],
    [4.6, off(thumb, 0.2, -2.3, 2.7), thumb.clone().add(V(40, 0)), 52, 1.0],
    [5.6, off(sBox, 0.5, -2.2, 3.0), sBox.clone().add(V(-20, 0)), 52, 1.0],
    [7.0, off(sBox, 0.1, -2.0, 2.9), sBox.clone().add(V(-50, 0)), 52, 1.1],
    [8.1, ...final(endBox)],
    [duration, ...final(endBox)],
  ]);

  function pose(t) {
    const cur = stateAt(t);
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, cur, t);
    cables.forEach((c, i) => {
      drawCable(c, t, 2.35 + i * 0.2, 0.6);
      if (fromTime(c) && cur.index > 0 && cur.since < 0.3) c.material.uniforms.pulse.value = -0.15 + 1.3 * (cur.since / 0.3);
    });
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stateAt(t).name) };
}
