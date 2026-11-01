// [[B2]] webTryDesktopFull
import { describe, it, expect } from "vitest";
import { QrCodeNode } from "../../src/graph/nodes/qr";

// The QR Code card on the core: its payloads and image are pinned by `crates/solenoid-core/src/nodes/qr.rs`'s tests,
// its symbols by the frozen encoder cases (coreQr.test.ts).

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
