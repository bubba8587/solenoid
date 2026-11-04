// [[C130]] rustCore, [[D99]] rustIsSpec
// Where the core ports a table the platform holds (Node's NFD), it is checked against the platform itself, every
// code point.
import { it, expect } from "vitest";
import { wasmInvokeSync } from "../../src/graph/engineWasm";

const call = (name: string, args: unknown[]) => wasmInvokeSync<{ str?: string; bool?: boolean; num?: string }>("engine_call", { name, args });

it("UNACCENT's NFD is this Node's, every code point after a letter and before a mark", { timeout: 30_000 }, () => {
  // UNACCENT spells these out itself after decomposing.
  const spelled: Record<string, string> = { "ß": "ss", "æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "œ": "oe",
    "Œ": "OE", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ð": "d", "Ð": "D", "þ": "th", "Þ": "TH",
    "ı": "i", "ŋ": "ng", "Ŋ": "NG" };
  const SPELLED = new RegExp(`[${Object.keys(spelled).join("")}]`, "g");
  const bad: string[] = [];
  const expected = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(SPELLED, (ch) => spelled[ch]);
  // Many code points per call, one per line: each line starts with a letter, so decomposing never reorders a mark
  // across a line break, and the joined text decomposes line by line.
  const flush = (cps: number[]) => {
    const lines = cps.map((c) => `e${String.fromCodePoint(c)}̴x`);
    const got = (call("UNACCENT", [lines.join("\n")]).str ?? "").split("\n");
    lines.forEach((t, i) => { if (got[i] !== expected(t)) bad.push(cps[i].toString(16)); });
  };
  let batch: number[] = [];
  for (let c = 0x80; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    batch.push(c);
    if (batch.length === 20_000) { flush(batch); batch = []; }
  }
  if (batch.length) flush(batch);
  expect(bad.slice(0, 5)).toEqual([]);
});
