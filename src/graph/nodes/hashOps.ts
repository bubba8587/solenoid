// [[C17]] shareImpl

export type HashAlgorithm = "sha256" | "sha1" | "md5" | "crc32" | "fnv1a32" | "fnv1a64";
export const HASH_ALGORITHM_META: Record<HashAlgorithm, { label: string; description: string }> = {
  sha256:  { label: "SHA-256",   description: "64 hex characters; the default in `hashlib` / `digest`." },
  sha1:    { label: "SHA-1",     description: "40 hex characters; legacy but still what git and many systems expect." },
  md5:     { label: "MD5",       description: "32 hex characters; legacy checksums and ETags." },
  crc32:   { label: "CRC-32",    description: "8 hex characters; `zlib.crc32`, the zip / PNG checksum." },
  fnv1a32: { label: "FNV-1a 32", description: "8 hex characters; fast non-cryptographic bucketing." },
  fnv1a64: { label: "FNV-1a 64", description: "16 hex characters; fast non-cryptographic bucketing." },
};

export function uuidV4(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
