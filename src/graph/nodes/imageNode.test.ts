import { describe, it, expect } from "vitest";
import { ImageNode } from "./annotation";
import { extractInit } from "../copyPaste";

// The Image node's persistence contract: a web URL round-trips through the save
// (and copy/paste), but a locally-attached file's data URL is deliberately NOT
// persisted — the JSON save can't embed image bytes yet (bundling comes later).

describe("ImageNode", () => {
  it("round-trips url, height, width, collapsed, label through extractInit", () => {
    const n = new ImageNode({ label: "Logo", url: "https://x/y.png", height: 200, width: 300, collapsed: true });
    const init = extractInit(n);
    expect(init.url).toBe("https://x/y.png");
    expect(init.height).toBe(200);
    expect(init.width).toBe(300);
    expect(init.collapsed).toBe(true);
    expect(init.label).toBe("Logo");
    const n2 = new ImageNode(init);
    expect(n2.url).toBe("https://x/y.png");
    expect(n2.height).toBe(200);
  });

  it("does NOT persist a local-file data URL", () => {
    const n = new ImageNode();
    n.dataUrl = "data:image/png;base64,AAAA";
    const init = extractInit(n);
    expect(init.dataUrl).toBeUndefined();
    // In-session src prefers the live dataUrl…
    expect(n.src).toBe("data:image/png;base64,AAAA");
    // …but a clone (paste / reload) has no dataUrl and falls back to the url.
    const clone = new ImageNode(init);
    expect(clone.dataUrl).toBe("");
    expect(clone.src).toBe("");
  });

  it("src prefers a fresh local attach over the saved url", () => {
    const n = new ImageNode({ url: "https://x/y.png" });
    expect(n.src).toBe("https://x/y.png");
    n.dataUrl = "data:image/png;base64,BBBB";
    expect(n.src).toBe("data:image/png;base64,BBBB");
  });
});
