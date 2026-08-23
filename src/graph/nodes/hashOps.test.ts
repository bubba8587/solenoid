import { describe, it, expect } from "vitest";
import { md5Hex, sha1Hex, sha256Hex, crc32Hex, fnv1a32Hex, fnv1a64Hex, base64Encode, base64Decode, uuidV4 } from "./hashOps";

// Reference digests from Python hashlib / zlib / base64 (2026-08-23).
describe("digests match hashlib", () => {
  const cases: [string, string, string, string, string][] = [
    ["", "d41d8cd98f00b204e9800998ecf8427e", "da39a3ee5e6b4b0d3255bfef95601890afd80709", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "00000000"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72", "a9993e364706816aba3e25717850c26c9cd0d89d", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "352441c2"],
    ["hello world", "5eb63bbbe01eeed093cb22bb8f5acdc3", "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed", "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", "0d4a1185"],
    ["Cr\u00e8me", "8df83342f6d82a2fb7fdd94bfc2da6bc", "e55268ae38a1775d8f78ea6885e7bf23af02b204", "dd9dae426beef0c1fae7a3d609b701ebfba42bb29449b634f4fb1ddea198a805", "e504a7c3"],
  ];
  it.each(cases)("%j", (text, md5, sha1, sha256, crc) => {
    expect(md5Hex(text)).toBe(md5);
    expect(sha1Hex(text)).toBe(sha1);
    expect(sha256Hex(text)).toBe(sha256);
    expect(crc32Hex(text)).toBe(crc);
  });
  it("block boundaries: 55 / 56 / 64 bytes and a multi-block message", () => {
    expect(md5Hex("a".repeat(55))).toBe("ef1772b6dff9a122358552954ad0df65");
    expect(sha256Hex("a".repeat(55)).slice(0, 16)).toBe("9f4390f8d30c2dd9");
    expect(md5Hex("a".repeat(56))).toBe("3b0c8ac703f828b04c6c197006d17218");
    expect(sha256Hex("a".repeat(56)).slice(0, 16)).toBe("b35439a4ac6f0948");
    expect(md5Hex("a".repeat(64))).toBe("014842d480b571495a4a0363793f7367");
    expect(sha256Hex("a".repeat(64)).slice(0, 16)).toBe("ffe054fe7ae0cb6d");
    const m = "The quick brown fox jumps over the lazy dog. ".repeat(3);
    expect(md5Hex(m)).toBe("e6f263d514adf884ef6cc864d206d462");
    expect(sha1Hex(m)).toBe("cad36c9a7b06732521999993937a688dbb8f9b99");
    expect(sha256Hex(m)).toBe("dc985401a68faff03051c78bbf32bb2fd27ba216b0dba19b050b936d534b8ba9");
  });
  it("FNV-1a 32 / 64", () => {
    expect(fnv1a32Hex("")).toBe("811c9dc5"); expect(fnv1a64Hex("")).toBe("cbf29ce484222325");
    expect(fnv1a32Hex("abc")).toBe("1a47e90b"); expect(fnv1a64Hex("abc")).toBe("e71fa2190541574b");
    expect(fnv1a32Hex("hello world")).toBe("d58b3fa7"); expect(fnv1a64Hex("hello world")).toBe("779a65e7023cd2e7");
  });
});

describe("base64 + uuid", () => {
  it("round-trips UTF-8; rejects garbage", () => {
    expect(base64Encode("abc")).toBe("YWJj");
    expect(base64Encode("hello world")).toBe("aGVsbG8gd29ybGQ=");
    expect(base64Encode("Cr\u00e8me br\u00fbl\u00e9e")).toBe("Q3LDqG1lIGJyw7tsw6ll");
    expect(base64Decode("Q3LDqG1lIGJyw7tsw6ll")).toBe("Cr\u00e8me br\u00fbl\u00e9e");
    expect(base64Decode("aGVsbG8gd29ybGQ=")).toBe("hello world");
    expect(base64Decode("aGVsbG8gd29ybGQ")).toBe("hello world"); // unpadded tolerated
    expect(base64Decode("not base64!")).toBeNull();
    expect(base64Decode("")).toBe("");
  });
  it("uuidV4 is RFC 4122 shaped and fresh each call", () => {
    const a = uuidV4(), b = uuidV4();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
