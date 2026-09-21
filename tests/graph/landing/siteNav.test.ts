// [[B2]] webTryDesktopFull
import { describe, expect, it } from "vitest";
import { downloadLabel } from "../../../src/graph/landing/siteNav";

describe("downloadLabel", () => {
  it("names the platform only where a desktop build exists", () => {
    expect(downloadLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Download for Windows");
    expect(downloadLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Download for Linux");
    expect(downloadLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Download");
    expect(downloadLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Download");
    expect(downloadLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("Download");
  });
});
