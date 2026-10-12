// [[C121]]
// Typing, 7.5 s: one Expression card assembles, then SQRT(3^2 + 4^2) is typed into it a key at a time, each
// keystroke the app's own layout of that prefix: the stray S becomes a socket and a 0, an open bracket reads
// #SYNTAX!, the closing one lands on 5. The camera rides along the end of the formula, racks to the answer, and
// settles straight on. Capture: scenes/typing.json.
import { assemble, enter, helpers, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 6.4;

export function setup({ THREE, data, cards, pieces }) {
  const { V, at, off, final } = helpers(THREE);
  const card = Object.values(cards)[0];
  assemble(THREE, card, 0.15, { wave: 0.75 });
  const names = data.states.map((s) => s.name);
  // a typist's rhythm: quick runs, a pause before the brackets and the operator
  const gaps = [0.16, 0.11, 0.13, 0.26, 0.12, 0.17, 0.11, 0.3, 0.14, 0.17, 0.11, 0.28];
  const times = [];
  let t = 1.75;
  for (const g of gaps.slice(0, names.length - 1)) times.push((t += g));
  const stateAt = stepper(names, { times });
  const lastKey = times[times.length - 1];

  // where the formula ends in each state: the rightmost glyph of the formula field
  const formulaEnd = new Map();
  for (const m of pieces) {
    const p = m.userData;
    if (p.part !== "formula" || !p.glyph) continue;
    const x = p.center[0] + p.size[0] / 2;
    for (const name of p.in) if (!formulaEnd.has(name) || formulaEnd.get(name).x < x) formulaEnd.set(name, { x, y: p.center[1] });
  }
  const b = card.userData.box;
  const hero = at(card.userData.hero ?? b);
  const caret = (name) => { const e = formulaEnd.get(name) ?? formulaEnd.get(names[0]); return V(e.x, -e.y); };
  const shots = [[0, off(at(b, 0.3, 0.2), -0.9, -2.1, 2.6), at(b, 0.45, 0.35), 32, 1.2], [1.6, off(caret(names[0]), -0.6, -1.6, 2.2), caret(names[0]), 40, 1.1]];
  times.forEach((tk, i) => shots.push([tk + 0.05, off(caret(names[i + 1]), -0.4 + 0.08 * i, -1.6, 2.1), caret(names[i + 1]), 42, 1.1]));
  shots.push([lastKey + 0.7, off(hero, 0.5, -1.4, 2.2), hero, 46, 1.3]);
  shots.push([lastKey + 1.6, ...final(data.states[data.states.length - 1].box)], [duration, ...final(data.states[data.states.length - 1].box)]);
  const shotAt = rig(THREE, shots);

  function pose(t) {
    const cur = stateAt(t);
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, cur, t);
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stateAt(t).name) };
}
