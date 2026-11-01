// [[D99]] rustIsSpec
// A recorded card call (tests/setup/nodeRecorder.ts) in the form fixtures/core/nodes/ freezes it, and the key that
// says two calls are the same case. freeze-nodes.mjs and answer-tests.mjs share them.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

export const LAYOUT = new Set(["width", "height", "x", "y", "collapsed"]);

/** Socket and input order is the card's (a row's place is its meaning), so they freeze as lists of pairs. */
export function frozenForm({ kind: _k, at: _a, unstable: u, sockets, outputs, inputs, ...c }) {
  if (c.init) for (const f of LAYOUT) delete c.init[f];
  return {
    ...c, sockets: Object.entries(sockets).map(([k, row]) => [k, ...row]),
    outputs: Object.entries(outputs).map(([k, row]) => [k, ...(Array.isArray(row) ? row : [row])]), inputs: Object.entries(inputs),
    ...(u ? { unstable: true } : {}),
  };
}

export const caseKey = (f) => JSON.stringify([f.init, f.literals, f.stringLiterals, f.sockets, f.outputs, f.inputs, f.ctx?.settings]);

export const readFixture = (file) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
