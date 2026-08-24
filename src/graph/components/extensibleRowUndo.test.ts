import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pushRowRemovalUndo, pushRowAddUndo } from "./ExtensibleInputs";
import { setPushHistory } from "../process";
import { FillNode } from "../nodes/list";
import { SwitchNode } from "../nodes/logic";
import { SetCellNode } from "../nodes/matrix";

// Undo/redo for extensible-row add/remove (the audit-found hole: the classic
// history preset recorded the CABLE removal but nothing recorded the ROW, so
// Ctrl+Z re-added a connection into a nonexistent input key). The helpers must
// restore the very same Input OBJECTS (socket type + label by identity) in the
// node's original key ORDER (positional nodes change meaning if rows reorder).

type Entry = { undo: () => void; redo: () => void };
let entries: Entry[] = [];

beforeEach(() => {
  entries = [];
  setPushHistory((a) => entries.push(a));
});
afterEach(() => {
  setPushHistory(() => {});
});

describe("pushRowRemovalUndo", () => {
  it("undo restores the same Input object in the original key order", () => {
    const n = new FillNode({ op: "coalesce" }); // ships with e0
    n.addValueInput(); // e1
    const e0 = n.inputs.e0;
    const orderBefore = Object.keys(n.inputs);

    pushRowRemovalUndo(n, ["e0"], () => n.removeValueInput("e0"));
    n.removeValueInput("e0");
    expect(n.inputs.e0).toBeUndefined();
    expect(entries).toHaveLength(1);

    entries[0].undo();
    expect(n.inputs.e0).toBe(e0); // identity — socket/label survive exactly
    expect(Object.keys(n.inputs)).toEqual(orderBefore); // e0 back BEFORE e1

    entries[0].redo();
    expect(n.inputs.e0).toBeUndefined();
    entries[0].undo(); // undo again after redo still works
    expect(n.inputs.e0).toBe(e0);
  });

  it("restores a PAIR as one entry (both halves, original order)", () => {
    const n = new SwitchNode(); // ships with 3 when/then pairs
    const [aKey, bKey] = n.valuePairKeys()[0];
    const a = n.inputs[aKey];
    const b = n.inputs[bKey];
    const orderBefore = Object.keys(n.inputs);

    pushRowRemovalUndo(n, [aKey, bKey], () => n.removeValuePair(aKey));
    n.removeValuePair(aKey);
    expect(n.inputs[aKey]).toBeUndefined();
    expect(n.inputs[bKey]).toBeUndefined();

    entries[0].undo();
    expect(n.inputs[aKey]).toBe(a);
    expect(n.inputs[bKey]).toBe(b);
    expect(Object.keys(n.inputs)).toEqual(orderBefore);
  });

  it("restores a TRIPLET as one entry (all three sockets, original order)", () => {
    const n = new SetCellNode();
    n.addValuePair(); // a second row, so the first can be removed
    const [v, r, c] = n.valuePairKeys()[0];
    const vi = n.inputs[v], ri = n.inputs[r], ci = n.inputs[c];
    const orderBefore = Object.keys(n.inputs);

    pushRowRemovalUndo(n, [v, r, c], () => n.removeValuePair(v));
    n.removeValuePair(v);
    expect(n.inputs[v]).toBeUndefined();
    expect(n.inputs[r]).toBeUndefined();
    expect(n.inputs[c]).toBeUndefined();

    entries[0].undo();
    expect(n.inputs[v]).toBe(vi);
    expect(n.inputs[r]).toBe(ri);
    expect(n.inputs[c]).toBe(ci);
    expect(Object.keys(n.inputs)).toEqual(orderBefore);
  });

  it("no entry is pushed for keys with no live input", () => {
    const n = new FillNode({ op: "coalesce" });
    pushRowRemovalUndo(n, ["nope"], () => {});
    expect(entries).toHaveLength(0);
  });
});

describe("pushRowAddUndo", () => {
  it("undo removes the added row; redo re-adds the same object", () => {
    const n = new FillNode({ op: "coalesce" });
    const key = n.addValueInput(); // e1
    const input = n.inputs[key];
    pushRowAddUndo(n, [key], () => n.removeValueInput(key));
    expect(entries).toHaveLength(1);

    entries[0].undo();
    expect(n.inputs[key]).toBeUndefined();
    entries[0].redo();
    expect(n.inputs[key]).toBe(input);
  });
});
