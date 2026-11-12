// [[B19]] spreadsheetHabits, [[engineering#Table work grows with the rows, never with rows squared, and drawing stops at the screen]]
// Timing checks that hold on any machine. A refusal that should answer at once is held to AT_ONCE_MS: far above a
// refused call on a loaded machine, far below the walk it refuses (which would run until the test's timeout). Work
// that must stay linear is held to how its time grows, not to a number of milliseconds.

export const AT_ONCE_MS = 5_000;

const timed = (f: () => void): number => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

/** How much longer `run` takes at four times the size: about 4 when linear, about 16 when quadratic. The best of
 *  five runs at each size, after a warm-up, so a garbage collection or a busy neighbour doesn't decide it; pick `n`
 *  so one run takes tens of milliseconds, or the noise is as large as the work. */
export function growthAt4x(run: (n: number) => void, n: number): number {
  run(n);
  const best = (m: number) => Math.min(...Array.from({ length: 5 }, () => timed(() => run(m))));
  return best(4 * n) / Math.max(best(n), 0.05);
}
