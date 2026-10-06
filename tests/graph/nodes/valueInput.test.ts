// [[B11]] maximalMerge, [[C118]] formatTravelsWithValue
import { describe, it, expect } from "vitest";
import { ValueInputNode, carryValueText } from "../../../src/graph/nodes/control";
import { isSolError } from "../../../src/graph/errorValue";
import { isUnitCell } from "../../../src/graph/unitValue";
import { extractInit } from "../../../src/graph/copyPaste";
import { SolenoidSocket } from "../../../src/graph/sockets";

const socketType = (n: ValueInputNode) => (n.outputs.value!.socket as SolenoidSocket).dataType;

describe("Value Input data()", () => {
  it("emits each type from the typed text", () => {
    expect(new ValueInputNode({ op: "number", value: "3.5" }).data().value).toBe(3.5);
    expect(new ValueInputNode({ op: "string", value: " hi " }).data().value).toBe(" hi ");
    expect(new ValueInputNode({ op: "logical", value: "TRUE" }).data().value).toBe(true);
    expect(new ValueInputNode({ op: "logical", value: "FALSE" }).data().value).toBe(false);
    expect(new ValueInputNode({ op: "date", value: "15-Mar-2026" }).data().value).toBe(46096);
  });

  it("reads a blank number as 0 and flags text that isn't one", () => {
    expect(new ValueInputNode({ op: "number", value: "" }).data().value).toBe(0);
    const bad = new ValueInputNode({ op: "number", value: "abc" }).data().value;
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
  });

  it("gives a blank or unreadable date no value", () => {
    expect(new ValueInputNode({ op: "date", value: "" }).data().value).toBeNull();
    expect(new ValueInputNode({ op: "date", value: "someday" }).data().value).toBeNull();
  });

  it("tags a number with the card's unit, and never a non-number", () => {
    const v = new ValueInputNode({ op: "number", value: "5", unit: "m" }).data().value;
    expect(isUnitCell(v)).toBe(true);
    expect(new ValueInputNode({ op: "string", value: "5", unit: "m" }).data().value).toBe("5");
  });

  it("caches the value for the hero box", () => {
    const n = new ValueInputNode({ op: "number", value: "7" });
    n.data();
    expect(n.cachedValue).toBe(7);
  });
});

describe("Value Input type switch", () => {
  it("swaps the output socket to the picked type", () => {
    const n = new ValueInputNode();
    expect(socketType(n)).toBe("number");
    expect(n.setOp("date")).toBe(true);
    expect(socketType(n)).toBe("date");
    expect(n.setOp("date")).toBe(false);
    n.setOp("logical");
    expect(socketType(n)).toBe("logical");
    n.setOp("string");
    expect(socketType(n)).toBe("string");
  });

  it("gives each type back what was typed under it, and carries by meaning only into a type not used yet", () => {
    const n = new ValueInputNode({ op: "string", value: "hello" });
    n.setOp("number");
    expect(n.value).toBe("0");
    n.value = "123.5";
    n.setOp("logical");
    expect(n.value).toBe("TRUE");
    n.setOp("string");
    expect(n.value).toBe("hello");
    n.setOp("number");
    expect(n.value).toBe("123.5");
    n.setOp("logical");
    expect(n.value).toBe("TRUE");
  });

  it("keeps the text where it still reads, else carries it by meaning", () => {
    expect(carryValueText("hello", "string")).toBe("hello");
    expect(carryValueText("12", "number")).toBe("12");
    expect(carryValueText("TRUE", "number")).toBe("1");
    expect(carryValueText("hello", "number")).toBe("0");
    expect(carryValueText("2", "logical")).toBe("TRUE");
    expect(carryValueText("0", "logical")).toBe("FALSE");
    expect(carryValueText("true", "logical")).toBe("TRUE");
    expect(carryValueText("15-Mar-2026", "date")).toBe("15-Mar-2026");
    expect(carryValueText("12", "date")).not.toBe("12");
  });
});

describe("Value Input format", () => {
  it("annotates its own output, dropping the unit off a non-number", () => {
    const n = new ValueInputNode({ op: "number", format: "percent", unit: "m" });
    expect(n.annotationFor("value")).toMatchObject({ format: "percent", unit: "m" });
    expect(n.annotationFor("other")).toBeUndefined();
    n.setOp("string");
    expect(n.annotationFor("value")).toMatchObject({ unit: "none" });
  });

  it("keeps an off-type style saved but inert", () => {
    const n = new ValueInputNode({ op: "number", format: "percent" });
    n.setOp("date");
    expect(n.effectiveFormat()).toBe("date_dmy");
    expect(n.format).toBe("percent");
    n.setOp("number");
    expect(n.effectiveFormat()).toBe("percent");
  });
});

describe("Value Input persistence", () => {
  it("round-trips through extractInit", () => {
    const n = new ValueInputNode({ op: "date", value: "15-Mar-2026", format: "date_iso", logicalStyle: "yesno", textCase: "upper" });
    const back = new ValueInputNode(extractInit(n) as ConstructorParameters<typeof ValueInputNode>[0]);
    expect(extractInit(back)).toEqual(extractInit(n));
    expect(back.data().value).toBe(46096);
  });

  it("falls back to Number on a stale type", () => {
    const n = new ValueInputNode({ op: "cube" as never });
    expect(n.op).toBe("number");
    expect(socketType(n)).toBe("number");
  });
});
