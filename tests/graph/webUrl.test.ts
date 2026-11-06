// [[B18]] safeToShare: a foreign document's web pictures wait for the network grant, however their address is spelled.
import { describe, it, expect } from "vitest";
import { isWebUrl, srcsetReachesWeb, CSS_FETCH } from "../../src/graph/webUrl";

describe("which addresses reach the web", () => {
  it("every spelling the browser resolves to another host does", () => {
    for (const a of ["https://x.example/a.png", "//x.example/a.png", " http://x.example/a.png", "\\\\x.example/a.png",
      "/\\x.example/a.png", "https:\\\\x.example/a", "ht\ntps://x.example/a", "HTTPS://X.EXAMPLE/a", "ftp://x.example/a"]) {
      expect(isWebUrl(a), a).toBe(true);
    }
  });
  it("pictures in the document and the app's own files don't", () => {
    for (const a of ["data:image/png;base64,AAAA", "blob:http://app.invalid/1", "images/a.png", "/a.png", "", "#x"]) {
      expect(isWebUrl(a), a).toBe(false);
    }
  });
  it("a srcset reaches the web when any candidate does, a data: picture's commas aside", () => {
    expect(srcsetReachesWeb("data:image/png;base64,AA,BB 1x")).toBe(false);
    expect(srcsetReachesWeb("a.png 1x, \\\\x.example/b.png 2x")).toBe(true);
  });
  it("CSS that fetches is caught", () => {
    for (const c of ["background:url(x)", "background-image: image-set('x.png' 1x)", "@import 'x.css';"]) expect(CSS_FETCH.test(c), c).toBe(true);
    expect(CSS_FETCH.test("color: red")).toBe(false);
  });
});
