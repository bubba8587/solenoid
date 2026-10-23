// [[D99]] rustIsSpec
// The QR encoder's symbols, frozen from the `qrcode` package (1.5.4) the QR Code card drew with, for the core's port
// (`crates/solenoid-core/src/qr.rs`, held to these by its `tests/qr.rs`): every mode and mode mix, lengths either side
// of each version's capacity, every error correction level, and texts that pick each mask. Here the card, on the core,
// draws the medium-level ones as frozen.
import { it, expect } from "vitest";
import { frozen } from "./coreFixtures";
import { QrCodeNode } from "../../src/graph/nodes/qr";

type Level = "L" | "M" | "Q" | "H";
type Case = { text: string; level: Level; version?: number; mask?: number; size?: number; modules?: string; thrown?: string };

it("QR symbols encode as frozen", async () => {
  const cases = frozen<Case>("qr-encoder", () => { throw new Error("frozen only"); });
  const masks = new Set(cases.filter((c) => c.mask !== undefined).map((c) => `${c.level}${c.mask}`));
  expect(masks.size).toBe(32);

  // The card draws at the medium level: its image is the frozen symbol, ringed by a four-module quiet zone.
  const bad: string[] = [];
  for (const c of cases) {
    if (c.level !== "M" || c.thrown !== undefined || c.text !== c.text.trim() || c.text.length > 400) continue;
    const n = new QrCodeNode();
    const chart = (await n.data({ text: [c.text] })).chart!;
    const svg = decodeURIComponent(chart.src.slice("data:image/svg+xml,".length));
    const size = c.size!;
    const want = new Set<string>();
    for (let i = 0; i < size * size; i++) if ((parseInt(c.modules![i >> 2], 16) >> (3 - (i & 3))) & 1) want.add(`M${(i % size) + 4} ${Math.floor(i / size) + 4}`);
    const got = new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `M${m[1]} ${m[2]}`));
    if (got.size !== want.size || [...want].some((k) => !got.has(k)) || !svg.includes(`viewBox="0 0 ${size + 8} ${size + 8}"`)) bad.push(JSON.stringify(c.text));
  }
  expect(bad).toEqual([]);
});
