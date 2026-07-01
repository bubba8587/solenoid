import { describe, it, expect } from "vitest";
import { ExactNode, TextFindNode } from "./text";
import { isSolError } from "../errorValue";
import { SolenoidSocket } from "../sockets";

// EXACT emits the first-class logical type (TRUE/FALSE), like Comparison / IS checks —
// not 1/0. FIND/SEARCH report a missing substring as #VALUE! (Excel + the formula path),
// not #N/A. Both were aligned during the formula-engine consolidation (2026-06-25).

describe("EXACT — logical output", () => {
  it("returns a real boolean", () => {
    expect(new ExactNode().data({ a: ["abc"], b: ["abc"] }).result).toBe(true);
    expect(new ExactNode().data({ a: ["abc"], b: ["abd"] }).result).toBe(false);
    expect(new ExactNode().data({ a: ["Abc"], b: ["abc"] }).result).toBe(false); // case-sensitive
  });
  it("declares a logical output socket", () => {
    const socket = new ExactNode().outputs.result!.socket;
    expect(socket instanceof SolenoidSocket && socket.dataType).toBe("logical");
  });
});

describe("FIND / SEARCH — missing substring is #VALUE!", () => {
  it("FIND finds (1-based) and errors #VALUE! when absent", () => {
    expect(new TextFindNode({ op: "find" }).data({ needle: ["l"], haystack: ["hello"], start: [1] }).result).toBe(3);
    const miss = new TextFindNode({ op: "find" }).data({ needle: ["z"], haystack: ["hello"], start: [1] }).result;
    expect(isSolError(miss) && miss.code).toBe("#VALUE!");
  });
  it("SEARCH is case-insensitive; #VALUE! when absent", () => {
    expect(new TextFindNode({ op: "search" }).data({ needle: ["L"], haystack: ["hello"], start: [1] }).result).toBe(3);
    const miss = new TextFindNode({ op: "search" }).data({ needle: ["z"], haystack: ["hello"], start: [1] }).result;
    expect(isSolError(miss) && miss.code).toBe("#VALUE!");
  });
});
