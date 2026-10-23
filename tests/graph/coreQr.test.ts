// [[D99]] rustIsSpec
// The QR encoder's symbols, frozen from the `qrcode` package (1.5.4) the QR Code card drew with, for the core's port
// (`crates/solenoid-core/src/qr.rs`, held to these by its `tests/qr.rs`): every mode and mode mix, lengths either side
// of each version's capacity, every error correction level, and texts that pick each mask. Here the card, on the core,
// draws the medium-level ones as frozen.
import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { frozen } from "./coreFixtures";
import { QrCodeNode } from "../../src/graph/nodes/qr";

type Level = "L" | "M" | "Q" | "H";
type Case = { text: string; level: Level; version?: number; mask?: number; size?: number; modules?: string; thrown?: string };

/** A small seeded generator, so a refreeze draws the same cases. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEVELS: Level[] = ["L", "M", "Q", "H"];

const MIXES = [
  "0", "7", "42", "123", "0123456789", "01234567890123456789", "A", "AB", "HELLO WORLD", "$%*+-./: ", "a", "hello world",
  "Hello, World!", "https://example.com", "https://example.com/path?q=1&r=two#frag", "HTTPS://EXAMPLE.COM/ABC",
  "ABC123", "123ABC", "A1B2C3D4", "ABC12345678DEF", "abc12345678def", "abc DEF ghi", "ABCDEFGH1234567890abcdefgh",
  "1234567890ABCDEFGHIJ", "x1234567890123456789y", "3.14159", "-7", "2024-01-15", "TRUE", "naïve café", "ÄÖü", "日本語のテキスト",
  "Ελληνικά", "😀ok", "😀😀😀", "line one\nline two", "tab\there", "WIFI:T:WPA;S:MyNet;P:secret;;",
  "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEMAIL:ada@x.io\nEND:VCARD", "MEBKM:TITLE:Example;URL:http://example.com;;",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "00000000000000000000000000000000000000000000000000",
  "A".repeat(60) + "1".repeat(60) + "a".repeat(60), "12AB34cd56EF78gh90", "ab1cd22ef333gh4444ij55555kl666666",
  "AB:CD/EF.GH-IJ+KL*MN%OP$QR", "Mississippi", "  pad  ", "A-B_C", "x,y",
];


it("QR symbols encode as frozen", async () => {
  const cases = frozen<Case>("qr-encoder", () => {
    const QRCode = createRequire(import.meta.url)("qrcode") as typeof import("qrcode");
    const out: Case[] = [];
    const add = (text: string, level: Level) => {
      try {
        const qr = QRCode.create(text, { errorCorrectionLevel: level });
        const size = qr.modules.size;
        let modules = "";
        for (let i = 0; i < size * size; i += 4) {
          let nib = 0;
          for (let b = 0; b < 4; b++) nib = (nib << 1) | (i + b < size * size ? qr.modules.data[i + b] & 1 : 0);
          modules += nib.toString(16);
        }
        out.push({ text, level, version: qr.version, mask: qr.maskPattern, size, modules });
      } catch (e) {
        out.push({ text, level, thrown: (e as Error).message });
      }
    };
    for (const level of LEVELS) for (const t of MIXES) add(t, level);
    // Either side of each version's capacity in each mode: every version up to 10 and the count-indicator widths'
    // boundaries (9 | 10, 26 | 27), a stride between, and the largest symbol's.
    const req = createRequire(import.meta.url);
    const Version = req("qrcode/lib/core/version") as { getCapacity: (v: number, l: unknown, m: unknown) => number };
    const ECLevel = req("qrcode/lib/core/error-correction-level") as Record<Level, unknown>;
    const Mode = req("qrcode/lib/core/mode") as Record<string, unknown>;
    const versions = [...Array.from({ length: 12 }, (_, i) => i + 1), 14, 17, 20, 23, 25, 26, 27, 28, 31, 35, 39, 40];
    for (const level of LEVELS) {
      for (const [mode, ch] of [["NUMERIC", "8"], ["ALPHANUMERIC", "K"], ["BYTE", "k"]] as const) {
        for (const v of versions) {
          const n = Version.getCapacity(v, ECLevel[level], Mode[mode]);
          add(ch.repeat(n), level);
          if (level === "M" || [1, 9, 26, 39, 40].includes(v)) add(ch.repeat(n + 1), level);
        }
      }
    }
    // Texts that pick each mask, twice at each level.
    const rand = rng(7);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 $%*+-./:";
    for (const level of LEVELS) {
      const picked = Array<number>(8).fill(0);
      for (let tries = 0; tries < 20000 && picked.some((k) => k < 2); tries++) {
        const len = 1 + Math.floor(rand() * 60);
        let t = "";
        for (let i = 0; i < len; i++) t += alphabet[Math.floor(rand() * alphabet.length)];
        const mask = QRCode.create(t, { errorCorrectionLevel: level }).maskPattern ?? 0;
        if (picked[mask] >= 2) continue;
        picked[mask]++;
        add(t, level);
      }
    }
    return out;
  });
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
