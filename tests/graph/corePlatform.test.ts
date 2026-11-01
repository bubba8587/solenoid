// [[C130]] rustCore, [[D99]] rustIsSpec
// Where the core ports a table the platform holds (Node's NFD), it is checked against the platform itself, every
// code point.
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
