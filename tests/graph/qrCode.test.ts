// [[B2]] webTryDesktopFull
import { describe, it, expect } from "vitest";
import { QrCodeNode } from "../../src/graph/nodes/qr";

// The QR Code card's answers are its frozen node cases (fixtures/core/nodes/QrCodeNode.json.gz) and its symbols the
// frozen encoder cases; this call's texts are too long to freeze.

describe("QR Code card templates", () => {
  const draw = async (template: "text" | "wifi" | "vcard", literals: Record<string, string>, text?: unknown[]) => {
    const n = new QrCodeNode({ qrTemplate: template });
    Object.assign(n.stringLiterals, literals);
    return (await n.data(text === undefined ? {} : { text: text as string[] })).chart;
  };
  it("draws long texts across the version sizes, and fails on one past the largest", async () => {
    for (const t of ["1".repeat(300), "A".repeat(500), "x".repeat(1000), "日本".repeat(200), "9".repeat(5000)]) {
      expect((await draw("text", {}, [t]))?.src).toMatch(/^data:image/);
    }
    await expect(draw("text", {}, ["z".repeat(3000)])).rejects.toMatchObject({ message: expect.stringContaining("too big") });
  });
});
