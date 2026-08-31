import { describe, it, expect } from "vitest";
import { dataUrlToBytes, bytesToDataUrl, sanitizeName } from "../../src/graph/imageAssets";

describe("imageAssets — data: URL ↔ bytes round trip", () => {
  it("round-trips bytes across the chunked encoder (past the 32k chunk seam)", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17); // 3 chunks, last partial
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const url = bytesToDataUrl(bytes, "image/png");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const back = dataUrlToBytes(url);
    expect(back).not.toBeNull();
    expect(back!.mime).toBe("image/png");
    expect(back!.bytes).toEqual(bytes);
  });

  it("rejects a non-base64 / malformed data URL instead of throwing", () => {
    expect(dataUrlToBytes("data:image/png,plaintext")).toBeNull();
    expect(dataUrlToBytes("https://example.com/a.png")).toBeNull();
    expect(dataUrlToBytes("data:image/png;base64,@@not-base64@@")).toBeNull();
  });
});

describe("imageAssets — sanitizeName", () => {
  it("strips path parts and characters Windows refuses, keeps spaces", () => {
    expect(sanitizeName("C:\\Users\\me\\my photo.png")).toBe("my photo.png");
    expect(sanitizeName("a/b/pic.jpg")).toBe("pic.jpg");
    expect(sanitizeName('we<ird>:"na|me?*.png')).toBe("weirdname.png");
  });

  it("falls back to 'image' when nothing survives", () => {
    expect(sanitizeName("")).toBe("image");
    expect(sanitizeName("???")).toBe("image");
  });
});
