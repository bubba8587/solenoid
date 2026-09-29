// [[B3]] sameNodeEverywhere
import { describe, it, expect } from "vitest";
import { latestOnlyQueue } from "../../src/graph/landing/landingCompute";

describe("latestOnlyQueue", () => {
  it("never overlaps two builds, and drops one superseded before it starts", async () => {
    const run = latestOnlyQueue();
    const log: string[] = [];
    const build = (name: string) => async () => {
      log.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`${name}:end`);
    };
    const a = run(build("a"));
    await Promise.resolve();
    const b = run(build("b"));
    const c = run(build("c"));
    await Promise.all([a, b, c]);
    expect(log).toEqual(["a:start", "a:end", "c:start", "c:end"]);
  });

  it("a failed build does not stop the next one", async () => {
    const run = latestOnlyQueue();
    const failed = run(async () => { throw new Error("x"); });
    await expect(failed).rejects.toThrow("x");
    let ran = false;
    await run(async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
