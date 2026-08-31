import { describe, it, expect } from "vitest";
import { toSolError, ipcInvoke, enginePing } from "../../src/graph/ipcBridge";
import { solError, isSolError } from "../../src/graph/errorValue";

describe("toSolError — IPC failure → tagged SolError", () => {
  it("passes an already-tagged SolError with a canonical code straight through", () => {
    const e = solError("#SHAPE!", "dims don't line up");
    expect(toSolError(e)).toBe(e);
  });

  it("re-mints a tagged SolError whose code is NOT canonical (the leak A3 flagged)", () => {
    // Rust IpcError always sets __solError: true, so a bad code would otherwise
    // ride the tagged short-circuit uncoerced.
    const bad = { __solError: true, code: "weird", message: "bad code from Rust" };
    const out = toSolError(bad);
    expect(out).not.toBe(bad);
    expect(out.code).toBe("#ERROR!");
    expect(out.message).toBe("bad code from Rust");
  });

  it("maps a Rust IpcError shape ({__solError, code, message}) to that code", () => {
    const rust = { __solError: true, code: "#VALUE!", message: "bad cast" };
    const out = toSolError(rust);
    expect(isSolError(out)).toBe(true);
    expect(out.code).toBe("#VALUE!");
    expect(out.message).toBe("bad cast");
  });

  it("trusts a bare {code, message} from Rust when code looks canonical", () => {
    const out = toSolError({ code: "#DIV/0!", message: "divide by zero" });
    expect(out.code).toBe("#DIV/0!");
    expect(out.message).toBe("divide by zero");
  });

  it("collapses a non-canonical code to #ERROR! but keeps the message", () => {
    const out = toSolError({ code: "weird", message: "huh" });
    expect(out.code).toBe("#ERROR!");
    expect(out.message).toBe("huh");
  });

  it("collapses a messageless object to #ERROR! with a fallback message", () => {
    const out = toSolError({ foo: 1 });
    expect(out.code).toBe("#ERROR!");
    expect(out.message).toBe("IPC call failed");
  });

  it("wraps a bare string rejection as #ERROR!", () => {
    const out = toSolError("command panicked");
    expect(out.code).toBe("#ERROR!");
    expect(out.message).toBe("command panicked");
  });

  it("handles non-object, non-string throws with a default", () => {
    expect(toSolError(42).code).toBe("#ERROR!");
    expect(toSolError(null).message).toBe("IPC call failed");
    expect(toSolError(undefined).code).toBe("#ERROR!");
  });
});

describe("desktop-only guards (node env → no Tauri runtime)", () => {
  it("enginePing resolves null off-desktop", async () => {
    await expect(enginePing()).resolves.toBeNull();
  });

  it("ipcInvoke rejects with a tagged #ERROR! off-desktop", async () => {
    const err = await ipcInvoke("engine_ping").catch((e) => e);
    if (!isSolError(err)) throw new Error("expected a SolError rejection");
    expect(err.code).toBe("#ERROR!");
    expect(err.message).toContain("without the desktop engine");
  });
});
