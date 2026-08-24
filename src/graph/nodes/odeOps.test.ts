import { describe, it, expect } from "vitest";
import { rk4 } from "./odeOps";

// Classic RK4, checked against closed-form solutions (SciPy solve_ivp / R deSolve give
// the same to well under the step error at 100 steps).
describe("rk4 (ODE integrate)", () => {
  it("dy/dt = y → e^t (within 1e-6 at t=1, 100 steps)", () => {
    const r = rk4((_, y) => y, 1, 0, 1, 100)!;
    expect(r.t).toHaveLength(101);
    expect(r.y[100]).toBeCloseTo(Math.E, 6);
  });

  it("dy/dt = -2y → e^(-2t)", () => {
    const r = rk4((_, y) => -2 * y, 1, 0, 1, 100)!;
    expect(r.y[r.y.length - 1]).toBeCloseTo(Math.exp(-2), 6);
  });

  it("dy/dt = t → t²/2 (RK4 is exact for a polynomial)", () => {
    const r = rk4((t) => t, 0, 0, 2, 50)!;
    expect(r.y[r.y.length - 1]).toBeCloseTo(2, 10); // 2²/2 = 2
  });

  it("steps clamp to at least 1", () => {
    const r = rk4((t) => t, 0, 0, 1, 0)!;
    expect(r.t).toEqual([0, 1]); // one step
  });

  it("a null derivative (bad expression) aborts with null", () => {
    expect(rk4(() => null, 1, 0, 1, 10)).toBeNull();
  });

  it("a blow-up (dy/dt = y², y0 = 1 past its pole at t=1) returns null", () => {
    expect(rk4((_, y) => y * y, 1, 0, 5, 1000)).toBeNull();
  });

  it("a non-finite bound is null", () => {
    expect(rk4((_, y) => y, 1, 0, Infinity, 10)).toBeNull();
  });
});
