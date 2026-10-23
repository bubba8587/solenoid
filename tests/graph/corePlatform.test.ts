// [[C130]] rustCore, [[D99]] rustIsSpec
// Where the core ports a table the platform holds (V8's RegExp Canonicalize, Node's NFD), it is checked against the
// platform itself, every unit or code point.
import { it, expect } from "vitest";
import { wasmInvokeSync } from "../../src/graph/engineWasm";

const call = (name: string, args: unknown[]) => wasmInvokeSync<{ str?: string; bool?: boolean; num?: string }>("engine_call", { name, args });

it("UNACCENT's NFD is this Node's, every code point after a letter and before a mark", { timeout: 60_000 }, () => {
  // UNACCENT spells these out itself after decomposing.
  const spelled: Record<string, string> = { "ß": "ss", "æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "œ": "oe",
    "Œ": "OE", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ð": "d", "Ð": "D", "þ": "th", "Þ": "TH",
    "ı": "i", "ŋ": "ng", "Ŋ": "NG" };
  const SPELLED = new RegExp(`[${Object.keys(spelled).join("")}]`, "g");
  const bad: string[] = [];
  for (let c = 0x80; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const t = `e${String.fromCodePoint(c)}̴x`;
    const want = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(SPELLED, (ch) => spelled[ch]);
    if (call("UNACCENT", [t]).str !== want) bad.push(c.toString(16));
  }
  expect(bad.slice(0, 5)).toEqual([]);
});

/** Whether V8 finds a caseless backreference in `text`, as REGEXTEST(text, "(.)\1", 1) asks. */
const v8Folds = (text: string) => /(.)\1/i.test(text);
const coreFolds = (text: string) => {
  const r = call("REGEXTEST", [text, "(.)\\1", 1]);
  return r.bool ?? (r.num !== undefined && r.num !== "0");
};

it("a caseless backreference folds as V8's Canonicalize: never a non-ASCII unit to ASCII", () => {
  for (const text of ["sſ", "ſs", "ſſ", "Ss", "ıI", "Iı", "ıı", "iI", "kK", "Kk", "ßß", "σΣ", "ςΣ"]) {
    expect(coreFolds(text), text).toBe(v8Folds(text));
  }
  expect(coreFolds("sſ")).toBe(false);
});

it("a caseless backreference matches as V8's for every BMP unit beside its own upper and lower case", () => {
  const bad: string[] = [];
  for (let c = 0; c < 0x10000; c++) {
    if (c >= 0xd800 && c < 0xe000) continue;
    const ch = String.fromCharCode(c);
    for (const other of new Set([ch.toUpperCase(), ch.toLowerCase()])) {
      if (other.length !== 1 || other === ch) continue;
      if (coreFolds(ch + other) !== v8Folds(ch + other)) bad.push(ch + other);
    }
  }
  expect(bad).toEqual([]);
});
