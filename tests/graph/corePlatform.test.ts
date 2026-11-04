// [[C130]] rustCore, [[D99]] rustIsSpec, [[rust-core#The Rust is the spec]]
import { it, expect } from "vitest";
import { wasmInvokeSync } from "../../src/graph/engineWasm";

const call = (name: string, args: unknown[]) => wasmInvokeSync<{ str?: string; bool?: boolean; num?: string }>("engine_call", { name, args });

it("UNACCENT's NFD is this Node's over the accented scripts, each code point after a letter and before a mark", () => {
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
  // Latin with its extensions (Vietnamese among them), combining marks, Greek, Cyrillic, and the Hangul syllables.
  const BLOCKS = [[0x80, 0x24f], [0x300, 0x36f], [0x370, 0x52f], [0x1e00, 0x1fff], [0xac00, 0xd7a3]];
  for (const [lo, hi] of BLOCKS) flush(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
  expect(bad.slice(0, 5)).toEqual([]);
});
