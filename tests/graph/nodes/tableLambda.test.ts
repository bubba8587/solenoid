import { describe, it, expect } from "vitest";
import { ReduceLambdaNode, ScanLambdaNode } from "../../../src/graph/nodes/tableLambda";
import { formatLambdaSig, undeclaredConsumerVars } from "../../../src/graph/nodes/lambda";

/** Narrow a node result the test knows is a lambda value (the node now returns a
 *  SolError on a broken lambda, so the union needs a guard before .params/.fn). */





describe("ScanLambda (SCAN)", () => {





  // The Initial input is a SCALAR seed. It was an `anyListIn` (list socket), so a
  // wired scalar arrived wrapped as `[v]`; `acc` then started as an array, the
  // fold broadcast to arrays, and every cell nulled out ("1×10 blank table").
  // REDUCE shared the bug. Guard the socket type on both.
  it("seeds from a scalar `any` socket, not a list (regression: blank table)", () => {
    expect(new ScanLambdaNode().inputs.initial!.socket.name).toBe("any");
    expect(new ReduceLambdaNode().inputs.initial!.socket.name).toBe("any");
  });

  // A wired lambda binds to (acc, value, step) BY NAME ([[C50]] lambdaBindsByName): declaration ORDER is
  // free, the names can't lie, captured constants pass through, and a param that
  // isn't one of the node's variables is a hard error.




  it("advisory names the consumer vars a lambda used but didn't declare", () => {
    const sig = new ScanLambdaNode().lambdaSig;
    expect(formatLambdaSig(sig)).toBe("acc, value, [step]");
    // captured = body vars that aren't params; advise only those that ARE our vars:
    expect(undeclaredConsumerVars([], sig)).toEqual([]);              // λ(acc, value): nothing captured
    expect(undeclaredConsumerVars(["acc"], sig)).toEqual(["acc"]);    // λ(value): acc captured → advise
    expect(undeclaredConsumerVars(["rate"], sig)).toEqual([]);        // a real constant → fine
    expect(undeclaredConsumerVars(["acc", "value"], sig)).toEqual(["acc", "value"]);
    expect(new ReduceLambdaNode().lambdaSig).toEqual(sig);
  });
});

// A km cell: n km stored as base-SI meters (n*1000), tagged length + display "km".
// BYROW answers one-column rows ([[D85]] columnsStayColumns); this reads them back as values.


