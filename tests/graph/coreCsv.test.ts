// [[C103]] untrustedContentSeams, [[D99]] rustIsSpec
// CSV text as Papa Parse read it and the typed frame the TS built from it, frozen before the reader moved to the core
// (`crates/solenoid-core/src/csv.rs`, held to these natively by its `tests/csv.rs`, and here through the callers): the
// rows under each option the callers pass, a file's typed columns, the Frame card's typed text, and the text a Sink
// writes, over a seeded generator of awkward CSV and the repo's own CSV files (its source is in git at a0ce6071).
import { it, expect } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { frozen, enc } from "./coreFixtures";
import { parseCsvRows, unparseCsv, type CsvOptions } from "../../src/graph/csv";
import { csvToFrame } from "../../src/graph/frameBackend";
import { parseFrameSource } from "../../src/graph/frame";

interface RowsCase { text: string; opts: CsvOptions; rows: string[][] }
interface ColumnsCase { text: string; columns: object[] }
interface UnparseCase { fields: string[]; data: string[][]; text: string }

const frozenOnly = (): never => { throw new Error("frozen only: the TS reader is gone"); };
const plain = (columns: readonly object[]) => columns.map((c) => ({ ...c }));

it("CSV text reads into rows as frozen", () => {
  const cases = frozen<RowsCase>("csv-rows", frozenOnly);
  expect(cases.length).toBe(11420);
  const bad = cases.filter((c) => JSON.stringify(parseCsvRows(c.text, c.opts)) !== JSON.stringify(c.rows));
  expect(bad.slice(0, 5)).toEqual([]);
});

it("a CSV file reads into a typed frame as frozen", () => {
  const cases = frozen<ColumnsCase>("csv-frames", frozenOnly);
  expect(cases.length).toBe(2855);
  const bad = cases.filter((c) => !isDeepStrictEqual(enc(plain(csvToFrame(c.text).columns)), enc(c.columns)));
  expect(bad.slice(0, 5)).toEqual([]);
});

it("a Frame card's CSV text reads into typed source columns as frozen", () => {
  const cases = frozen<ColumnsCase>("csv-sources", frozenOnly);
  expect(cases.length).toBe(2855);
  const bad = cases.filter((c) => !isDeepStrictEqual(plain(parseFrameSource(c.text)), c.columns));
  expect(bad.slice(0, 5)).toEqual([]);
});

it("rows write as CSV text as frozen", () => {
  const cases = frozen<UnparseCase>("csv-unparse", frozenOnly);
  expect(cases.length).toBe(800);
  const bad = cases.filter((c) => unparseCsv(c.fields, c.data) !== c.text);
  expect(bad.slice(0, 5)).toEqual([]);
});
