import { describe, it, expect } from "vitest";
import { writeTextForm, readTextForm } from "./textForm";
import type { SavedGraph } from "./persistence";

// Reader-robustness fuzz: `readTextForm` is about to sit behind user-facing
// surfaces (a "view/edit as text" panel, external editors via file-over-app),
// so arbitrary malformed input must either throw a CLEAN Error or return a
// graph the writer can serialize again — never hang, never throw a non-Error,
// never hand back a half-parsed structure that detonates one step later.
// Seeded PRNG (mulberry32, the modelFuzz.ts pattern) so any failure reproduces
// from its printed seed.

const seedModules = import.meta.glob("./seedGraphs/*.json", { eager: true }) as Record<
  string,
  { default?: SavedGraph } & SavedGraph
>;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One random structural mutation per mutant — the shapes a hand edit or a bad
// merge would actually produce.
const NOISE = ['"', "\\", "<-", "=", ":", "---", "\n", " ", "{", "}", "lit:", "str:", "\u0000", "é"];
function mutate(text: string, rng: () => number): string {
  const kind = Math.floor(rng() * 6);
  const at = Math.floor(rng() * text.length);
  switch (kind) {
    case 0: return text.slice(0, at); // truncate
    case 1: return text.slice(0, at) + text.slice(at + 1 + Math.floor(rng() * 8)); // delete a span
    case 2: return text.slice(0, at) + NOISE[Math.floor(rng() * NOISE.length)] + text.slice(at); // inject noise
    case 3: { // duplicate a random line
      const lines = text.split("\n");
      const i = Math.floor(rng() * lines.length);
      lines.splice(i, 0, lines[i]);
      return lines.join("\n");
    }
    case 4: { // swap two random chars
      if (text.length < 2) return text;
      const b = Math.floor(rng() * text.length);
      const arr = [...text];
      [arr[at % arr.length], arr[b]] = [arr[b], arr[at % arr.length]];
      return arr.join("");
    }
    default: return text.slice(at) + text.slice(0, at); // rotate (mangles the header/sidecar split)
  }
}

describe("textForm reader fuzz", () => {
  const graphs = Object.values(seedModules).map((m) => (m.default ?? m) as SavedGraph);
  // Two representative seeds keep the corpus varied but the suite fast: the
  // biggest text (most grammar surface) and the first (typical).
  const corpus = [...graphs]
    .map((g) => writeTextForm(g))
    .sort((a, b) => b.length - a.length)
    .filter((_, i, arr) => i === 0 || i === arr.length - 1);

  it("every mutant either throws a clean Error or yields a re-writable graph", () => {
    const rng = mulberry32(0xF0221);
    let accepted = 0;
    let rejected = 0;
    for (const base of corpus) {
      for (let i = 0; i < 400; i++) {
        const mutant = mutate(base, rng);
        let g: SavedGraph | null = null;
        try {
          g = readTextForm(mutant);
        } catch (e) {
          expect(e, `mutant #${i} threw a non-Error`).toBeInstanceOf(Error);
          rejected++;
          continue;
        }
        // Accepted mutants must hold the reader's own postconditions…
        const names = new Set(g.nodes.map((n) => n.name));
        expect(names.size, `mutant #${i} produced duplicate names`).toBe(g.nodes.length);
        // …and survive the writer (round-trip closure — no half-parsed value
        // that only detonates on the next save).
        expect(() => writeTextForm(g!), `mutant #${i} read OK but crashed the writer`).not.toThrow();
        accepted++;
      }
    }
    // Sanity: the fuzz actually exercised both paths.
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("pathological inputs are rejected or handled, never hung", () => {
    const cases = [
      "", "---", "---\n", "\n\n\n---\nnull\n",
      "A: B \\", // trailing backslash mid-token
      'A: B x="unterminated', // unterminated string to EOL
      "A: B <-.\n---\n{}", // op with no key
      "A: B in<-\n---\n{}", // connection with no target
      `A: B\n---\n${"[".repeat(2000)}`, // deep-nesting sidecar JSON
      `${"x".repeat(100_000)}\n---\n{}`, // one huge junk line
    ];
    for (const c of cases) {
      try {
        const g = readTextForm(c);
        expect(() => writeTextForm(g)).not.toThrow();
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });
});
