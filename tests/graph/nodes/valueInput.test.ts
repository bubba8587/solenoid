// [[B11]] maximalMerge, [[C118]] formatTravelsWithValue
import { describe, it, expect } from "vitest";
import { ValueInputNode, carryValueText } from "../../../src/graph/nodes/control";
import { extractInit } from "../../../src/graph/nodeInit";
import { SolenoidSocket } from "../../../src/graph/sockets";

const socketType = (n: ValueInputNode) => (n.outputs.value!.socket as SolenoidSocket).dataType;


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
