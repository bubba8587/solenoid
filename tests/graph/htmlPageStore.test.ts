// [[reports-and-notes#HTML pages]], [[C68]] knapIsTheDocumentSyntax
import { describe, it, expect, afterEach } from "vitest";
import { htmlPageStore } from "../../src/graph/htmlPageStore";

describe("the open HTML Page", () => {
  afterEach(() => htmlPageStore.close());

  it("steps Back through the pages links opened, then to the canvas", () => {
    htmlPageStore.open("contents");
    htmlPageStore.open("roadtrip", true);
    htmlPageStore.open("annual", true);
    expect(htmlPageStore.openNodeId()).toBe("annual");
    htmlPageStore.back();
    expect(htmlPageStore.openNodeId()).toBe("roadtrip");
    htmlPageStore.back();
    expect(htmlPageStore.openNodeId()).toBe("contents");
    htmlPageStore.back();
    expect(htmlPageStore.openNodeId()).toBeNull();
  });

  it("starts a new trail when a page opens from its card, and Close leaves every page", () => {
    htmlPageStore.open("contents");
    htmlPageStore.open("roadtrip", true);
    htmlPageStore.open("invoice");
    expect(htmlPageStore.trailLength()).toBe(0);
    htmlPageStore.open("annual", true);
    htmlPageStore.close();
    expect(htmlPageStore.openNodeId()).toBeNull();
    expect(htmlPageStore.trailLength()).toBe(0);
  });
});
