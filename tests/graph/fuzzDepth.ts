// How hard a seeded fuzz loop pushes. By default it runs its everyday count on its fixed seed, so a run is quick and a
// failure reproduces. FUZZ=deep runs ten times as many on a fresh seed, printed, to reach inputs the fixed seed never
// makes (.github/workflows/fuzz.yml, weekly); FUZZ_SEED=<n> replays a printed seed.
export const DEEP = process.env.FUZZ === "deep";

/** The loop's count: `everyday`, or ten times it under FUZZ=deep. */
export const fuzzRuns = (everyday: number): number => (DEEP ? everyday * 10 : everyday);

/** The loop's seed: FUZZ_SEED when given, else a fresh one under FUZZ=deep (printed with `label`), else `fixed`. */
export function fuzzSeed(fixed: number, label: string): number {
  const given = process.env.FUZZ_SEED;
  if (given !== undefined && given !== "") return Number(given) >>> 0;
  if (!DEEP) return fixed;
  const seed = Math.floor(Math.random() * 2 ** 32) >>> 0;
  console.log(`[fuzz] ${label}: seed ${seed} (FUZZ_SEED=${seed} replays it)`);
  return seed;
}
