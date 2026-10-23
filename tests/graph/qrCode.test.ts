// [[B2]] webTryDesktopFull
import { describe, it, expect } from "vitest";
import { buildQrPayload, qrModulesToSvg, svgDataUrl } from "../../src/graph/qrCode";
import { QrCodeNode } from "../../src/graph/nodes/qr";

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
  it("hidden with no password keeps H:true before the closing ;;", () => {
    expect(buildQrPayload("wifi", { ssid: "N", wifiAuth: "nopass", wifiHidden: true }))
      .toBe("WIFI:T:nopass;S:N;H:true;;");
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

describe("QR Code card templates", () => {
  const draw = async (template: "text" | "wifi" | "vcard", literals: Record<string, string>, text?: unknown[]) => {
    const n = new QrCodeNode({ qrTemplate: template });
    Object.assign(n.stringLiterals, literals);
    return (await n.data(text === undefined ? {} : { text: text as string[] })).chart;
  };
  it("draws a Wi-Fi code for each security and the hidden flag", async () => {
    for (const lits of <Record<string, string>[]>[
      { ssid: "MyNet", wifiPass: "secret" }, { ssid: "Cafe;A", wifiPass: 'p:a"b', wifiAuth: "WEP" }, { ssid: "Open", wifiAuth: "nopass" },
      { ssid: "N", wifiPass: "p", wifiHidden: "true" }, { ssid: "  Spaced  ", wifiPass: "x\\y" }, { ssid: "Home", wifiAuth: "" },
    ]) expect((await draw("wifi", lits))?.src).toMatch(/^data:image\/svg\+xml,/);
  });
  it("draws no Wi-Fi code without a network name", async () => {
    expect(await draw("wifi", { ssid: "  ", wifiPass: "p" })).toBeNull();
  });
  it("draws a contact code from the filled fields only", async () => {
    for (const lits of <Record<string, string>[]>[
      { vcName: "Ada Lovelace", vcEmail: "ada@x.io" }, { vcName: "Grace", vcPhone: "+1 555 0100", vcOrg: "Navy", vcUrl: "https://navy.mil" },
      { vcPhone: "  12345  " }, { vcName: "Émile Zola", vcOrg: "Les Éditions" },
    ]) expect((await draw("vcard", lits))?.src).toMatch(/^data:image\/svg\+xml,/);
    expect(await draw("vcard", { vcName: " " })).toBeNull();
  });
  it("draws the wired text, ignoring the typed one, and nothing for a list or a number", async () => {
    expect((await draw("text", { text: "typed" }, ["WIRED 123"]))?.src).toMatch(/^data:image/);
    expect(await draw("text", { text: "typed" }, [42])).toBeNull();
    expect(await draw("text", {}, [["a", "b"]])).toBeNull();
    expect((await draw("wifi", { ssid: "Net" }, ["ignored"]))?.src).toMatch(/^data:image/);
  });
  it("draws long texts across the version sizes, and fails on one past the largest", async () => {
    for (const t of ["1".repeat(300), "A".repeat(500), "x".repeat(1000), "日本".repeat(200), "9".repeat(5000)]) {
      expect((await draw("text", {}, [t]))?.src).toMatch(/^data:image/);
    }
    await expect(draw("text", {}, ["z".repeat(3000)])).rejects.toMatchObject({ message: expect.stringContaining("too big") });
  });
});

describe("QR Code node image", () => {
  it("a new height or label redraws the image for the same payload", async () => {
    const n = new QrCodeNode();
    n.stringLiterals.text = "https://example.com";
    const first = (await n.data({})).chart!;
    n.height = 320;
    n.label = "Site";
    const second = (await n.data({})).chart!;
    expect([second.height, second.alt]).toEqual([320, "Site"]);
    expect(first.height).toBe(200);
  });
});
