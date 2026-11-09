// [[D99]] rustIsSpec
// A recorded card call (tests/setup/nodeRecorder.ts) in the form fixtures/core/nodes/ freezes it, and the key that
// says two calls are the same case. freeze-nodes.mjs and answer-tests.mjs share them.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

export const LAYOUT = new Set(["width", "height", "x", "y", "collapsed"]);

/** Classes the core has no body for: they compute in TypeScript (I/O, documents, composites and other structure), so
 *  a frozen case of theirs would hold nothing to anything. The freeze skips them; coreNodes.test.ts fails a fixture
 *  for a class the core can't answer. */
export const STAYS_IN_TS = new Set([
  "CompositeInputNode", "CompositeNode", "CompositeOutputNode", "ConduitNode", "DataFeedNode", "FileLinkNode",
  "FxNode", "GeocodeNode", "GroupNode", "HolidaysNode", "ImageNode", "ImportHtmlNode",
  "ImportObsidianNode", "ImportXmlNode", "LocalFileNode", "NoteNode", "PresentationNode", "ReportNode",
  "SaveTimesNode", "ScriptNode", "SessionHistoryNode", "TaskNotesNode", "VaultFolderNode", "WeatherNode",
  "WebSourceNode", "WriteFileNode", "WriteObsidianNode", "WriteTasksNode",
]);

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
