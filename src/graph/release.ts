// [[A1]] visualGraphCalculator
// The release `develop`'s unreleased work goes out in. A card added or reworked since the last release says
// `added: NEXT_RELEASE` or `updated: NEXT_RELEASE` in nodeCatalog.ts; `scripts/release-version.mjs <x.y.z>` freezes
// those to the literal version, bumps the app's version everywhere, and moves this to the next x.y. Set it by hand
// (an x.y.z) when the next release is a patch.

/** A Solenoid release: `major.minor`, or `major.minor.patch` for a patch release. */
export type Release = `${number}.${number}` | `${number}.${number}.${number}`;

export const NEXT_RELEASE: Release = "1.7";

/** Orders two releases; a missing part is 0, so 1.6 is 1.6.0. */
export function compareRelease(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
