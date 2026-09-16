import { describe, it, expect } from "vitest";
import { buildQrPayload, qrModulesToSvg, svgDataUrl } from "../../src/graph/qrCode";

// C1 QR Code — payload assembly + SVG rendering are pure + fixture-tested (widget rule 5).
// The encoding itself is the `qrcode` package, imported lazily in the node.

describe("buildQrPayload — text", () => {
  it("returns the trimmed text", () => {
    expect(buildQrPayload("text", { text: "  https://example.com  " })).toBe("https://example.com");
  });
  it("empty text → empty (no code)", () => {
    expect(buildQrPayload("text", { text: "   " })).toBe("");
  });
});

describe("buildQrPayload — wifi", () => {
  it("builds the WIFI: grammar", () => {
    expect(buildQrPayload("wifi", { ssid: "MyNet", wifiPass: "secret", wifiAuth: "WPA" }))
      .toBe("WIFI:T:WPA;S:MyNet;P:secret;;");
  });
  it("escapes the reserved characters in SSID and password", () => {
    expect(buildQrPayload("wifi", { ssid: "Cafe;A", wifiPass: 'p:a"b', wifiAuth: "WPA" }))
      .toBe('WIFI:T:WPA;S:Cafe\\;A;P:p\\:a\\"b;;');
  });
  it("nopass drops the password field", () => {
    expect(buildQrPayload("wifi", { ssid: "Open", wifiAuth: "nopass" })).toBe("WIFI:T:nopass;S:Open;;");
  });
  it("hidden adds H:true", () => {
    expect(buildQrPayload("wifi", { ssid: "N", wifiPass: "p", wifiAuth: "WPA", wifiHidden: true }))
      .toBe("WIFI:T:WPA;S:N;P:p;H:true;;");
  });
  it("no SSID → empty (no code)", () => {
    expect(buildQrPayload("wifi", { ssid: "", wifiPass: "p" })).toBe("");
  });
});

describe("buildQrPayload — vcard", () => {
  it("emits only the filled lines, wrapped in VCARD", () => {
    expect(buildQrPayload("vcard", { vcName: "Ada Lovelace", vcEmail: "ada@x.io" }))
      .toBe("BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEMAIL:ada@x.io\nEND:VCARD");
  });
  it("nothing filled → empty (no code)", () => {
    expect(buildQrPayload("vcard", {})).toBe("");
  });
});

describe("qrModulesToSvg", () => {
  // A 2×2 matrix: dark on the diagonal.
  const data = new Uint8Array([1, 0, 0, 1]);
  it("draws a path rect per dark module, offset by the quiet-zone margin", () => {
    const svg = qrModulesToSvg(2, data, 1); // margin 1 → 4×4 viewBox
    expect(svg).toContain('viewBox="0 0 4 4"');
    expect(svg).toContain("M1 1h1v1h-1z"); // module (0,0) at margin 1
    expect(svg).toContain("M2 2h1v1h-1z"); // module (1,1)
    expect(svg).not.toContain("M1 2"); // (0,1) is light
  });
  it("has a white ground and one black path", () => {
    const svg = qrModulesToSvg(2, data, 0);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
  });
});

describe("svgDataUrl", () => {
  it("wraps an SVG as a utf8 data URL", () => {
    const url = svgDataUrl("<svg/>");
    expect(url).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  });
});
