// [[C17]] shareImpl: the Regex card reads its pattern with the JavaScript flags typed on it, as `new RegExp` does.
import { describe, it, expect } from "vitest";
import { RegexNode, type RegexOp } from "../../src/graph/nodes/text";

const run = (op: RegexOp, flags: string, text: unknown, pattern: string, replacement = "", occurrence?: number) => {
  const n = new RegexNode({ op });
  n.stringLiterals = { pattern, replacement, flags };
  if (occurrence !== undefined) n.literals.occurrence = occurrence;
  return n.data({ text: [text] }).result;
};

describe("the Regex card's flags", () => {
  it("i, m and s change what matches", () => {
    expect(run("test", "i", "Hello", "hello")).toBe(1);
    expect(run("test", "", "a\nb", "^b$")).toBe(0);
    expect(run("test", "m", "a\nb", "^b$")).toBe(1);
    expect(run("test", "m", "a\r\nb", "a$")).toBe(1);
    expect(run("test", "", "a\nb", "a.b")).toBe(0);
    expect(run("test", "s", "a\nb", "a.b")).toBe(1);
    expect(run("extract", "ms", "x\ny z", "^y.z$")).toBe("y z");
  });

  it("y holds every match to where the last one ended", () => {
    expect(run("test", "y", "xab", "ab")).toBe(0);
    expect(run("test", "y", "abx", "ab")).toBe(1);
    expect(run("extract_all", "y", "aaba", "a")).toEqual(["a", "a"]);
    expect(run("extract_all", "y", "baa", "a")).toEqual([]);
    expect(run("replace", "y", "aaba", "a", "x")).toBe("xxba");
    expect(run("replace", "y", "aaba", "a", "x", -1)).toBe("axba");
    expect(run("extract", "gy", "ba", "a")).toBe("");
  });

  it("g makes REGEXEXTRACT's groups the matches after the first", () => {
    expect(run("extract", "g", "a1b22", "\\d+")).toBe("1");
    expect(run("extract_groups", "", "a1 b2", "(\\w)(\\d)")).toEqual(["a", "1"]);
    expect(run("extract_groups", "g", "a1 b2 c3", "(\\w)(\\d)")).toEqual(["b2", "c3"]);
    expect(run("extract_groups", "g", "zz", "(\\w)(\\d)")).toEqual([]);
    expect(run("replace", "gi", "AaA", "a", "x", 2)).toBe("AxA");
  });

  it("u reads by code point, folds case by Unicode, and takes the strict syntax", () => {
    expect(run("replace", "", "😀😀", ".", "x")).toBe("xxxx");
    expect(run("replace", "u", "😀😀", ".", "x")).toBe("xx");
    expect(run("extract_all", "u", "😀", "(?:)")).toEqual(["", ""]);
    expect(run("extract_all", "", "😀", "(?:)")).toEqual(["", "", ""]);
    expect(run("test", "u", "😀", "^\\u{1F600}$")).toBe(1);
    expect(run("test", "iu", "ſ", "s")).toBe(1);
    expect(run("test", "i", "ſ", "s")).toBe(0);
    expect(run("test", "u", "a", "\\a")).toBeNull();
    expect(run("test", "", "a", "\\a")).toBe(1);
    expect(run("extract", "u", "x😀y", "[😀]")).toBe("😀");
    expect(run("test", "v", "b", "[[a-z]--[aeiou]]")).toBe(1);
    expect(run("test", "v", "a", "[[a-z]--[aeiou]]")).toBe(0);
  });

  it("d changes nothing here, and a flag JavaScript doesn't take, or one twice, is no pattern", () => {
    expect(run("test", "d", "abc", "b")).toBe(1);
    expect(run("test", "x", "abc", "b")).toBeNull();
    expect(run("test", "gg", "abc", "b")).toBeNull();
    expect(run("test", "uv", "abc", "b")).toBeNull();
  });
});
