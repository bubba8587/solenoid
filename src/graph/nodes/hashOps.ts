// Pure, synchronous digests for the Hash card and HASH(): hashlib / digest() on a
// text cell — the join-key anonymiser. WebCrypto's SHA is async-only, so the
// classic algorithms live here in full; verified against Python hashlib
// (hashOps.test.ts). UTF-8 in, lowercase hex out.

export type HashAlgorithm = "sha256" | "sha1" | "md5" | "crc32" | "fnv1a32" | "fnv1a64";
export const HASH_ALGORITHM_META: Record<HashAlgorithm, { label: string; description: string }> = {
  sha256:  { label: "SHA-256",   description: "64 hex characters; the default in hashlib / digest()." },
  sha1:    { label: "SHA-1",     description: "40 hex characters; legacy but still what git and many systems expect." },
  md5:     { label: "MD5",       description: "32 hex characters; legacy checksums and ETags." },
  crc32:   { label: "CRC-32",    description: "8 hex characters; zlib.crc32, the zip / PNG checksum." },
  fnv1a32: { label: "FNV-1a 32", description: "8 hex characters; fast non-cryptographic bucketing." },
  fnv1a64: { label: "FNV-1a 64", description: "16 hex characters; fast non-cryptographic bucketing." },
};

const utf8 = new TextEncoder();
const hex32 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");

/** Pad to the Merkle–Damgård block layout: 0x80, zeros, 64-bit bit-length (BE for SHA, LE for MD5). */
function padded(bytes: Uint8Array, littleEndianLength: boolean): Uint8Array {
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
  const view = new DataView(buf.buffer);
  if (littleEndianLength) { view.setUint32(total - 8, lo, true); view.setUint32(total - 4, hi, true); }
  else { view.setUint32(total - 8, hi, false); view.setUint32(total - 4, lo, false); }
  return buf;
}

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

export function md5Hex(text: string): string {
  const buf = padded(utf8.encode(text), true);
  const view = new DataView(buf.buffer);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  const M = new Array<number>(16);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let a = h0, b = h1, c = h2, d = h3;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d; d = c; c = b;
      b = (b + rotl((a + f + MD5_K[i] + M[g]) >>> 0, MD5_S[i])) >>> 0;
      a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
  }
  const le = (n: number) => hex32(((n & 0xff) << 24) | ((n & 0xff00) << 8) | ((n >>> 8) & 0xff00) | (n >>> 24));
  return le(h0) + le(h1) + le(h2) + le(h3);
}

export function sha1Hex(text: string): string {
  const buf = padded(utf8.encode(text), false);
  const view = new DataView(buf.buffer);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return hex32(h0) + hex32(h1) + hex32(h2) + hex32(h3) + hex32(h4);
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Hex(text: string): string {
  const buf = padded(utf8.encode(text), false);
  const view = new DataView(buf.buffer);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(hex32).join("");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32Hex(text: string): string {
  let c = 0xffffffff;
  for (const b of utf8.encode(text)) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return hex32((c ^ 0xffffffff) >>> 0);
}

export function fnv1a32Hex(text: string): string {
  let h = 0x811c9dc5;
  for (const b of utf8.encode(text)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return hex32(h);
}
export function fnv1a64Hex(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of utf8.encode(text)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}

export function hashText(text: string, algorithm: HashAlgorithm = "sha256"): string {
  switch (algorithm) {
    case "sha256":  return sha256Hex(text);
    case "sha1":    return sha1Hex(text);
    case "md5":     return md5Hex(text);
    case "crc32":   return crc32Hex(text);
    case "fnv1a32": return fnv1a32Hex(text);
    case "fnv1a64": return fnv1a64Hex(text);
  }
}

// ─── Base64 (UTF-8 text ↔ standard alphabet with padding) ───
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64Encode(text: string): string {
  const bytes = utf8.encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63]
      + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : "=")
      + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}
/** `null` for text that is not valid base64 (the caller maps it to #VALUE!). */
export function base64Decode(text: string): string | null {
  const clean = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return null;
  const body = clean.replace(/=+$/, "");
  const bytes: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of body) {
    acc = (acc << 6) | B64.indexOf(ch); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 0xff); }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); } catch { return null; }
}

/** A fresh random v4 UUID (RFC 4122) from the platform CSPRNG. */
export function uuidV4(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
