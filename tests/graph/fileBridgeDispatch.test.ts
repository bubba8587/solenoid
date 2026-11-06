// [[B2]] webTryDesktopFull: every file call goes to the files its path is, an Android granted folder's, the demo
// vault's or the desktop's.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", async (orig) => ({ ...(await orig<object>()), invoke: (...a: unknown[]) => invoke(...a) }));

const { readBinaryFilePath, writeBinaryFilePath, setFsProvider } = await import("../../src/graph/fileBridge");
type Provider = Parameters<typeof setFsProvider>[0];

const TREE = "content://com.android.externalstorage.documents/tree/primary%3ADocs";
const desk = { readBinary: vi.fn(), writeBinary: vi.fn() };

afterEach(() => { invoke.mockReset(); desk.readBinary.mockReset(); desk.writeBinary.mockReset(); setFsProvider(null); });

describe("binary files go through the path's own files", () => {
  it("a granted folder's image is read and written through Android, not the desktop's files", async () => {
    setFsProvider(desk as unknown as Provider);
    invoke.mockResolvedValue({ base64: "AQI=" });
    expect(Array.from(await readBinaryFilePath(`${TREE}/assets/a.png`))).toEqual([1, 2]);
    await writeBinaryFilePath(`${TREE}/assets/b.png`, new Uint8Array([3]));
    expect(invoke.mock.calls.map((c) => (c[1] as { cmd: string }).cmd)).toEqual(["readBinary", "writeBinary"]);
    expect(desk.readBinary).not.toHaveBeenCalled();
    expect(desk.writeBinary).not.toHaveBeenCalled();
  });

  it("the demo vault refuses a binary write instead of handing it to the desktop", async () => {
    setFsProvider(desk as unknown as Provider);
    await expect(writeBinaryFilePath("solenoid:demo-vault/assets/a.png", new Uint8Array([1]))).rejects.toThrow();
    expect(desk.writeBinary).not.toHaveBeenCalled();
  });

  it("no function past the desktop provider calls the Tauri file plugin directly", () => {
    const src = readFileSync("src/graph/fileBridge.ts", "utf8");
    const after = src.slice(src.indexOf("function baseFs("));
    expect(after).not.toMatch(/(?<![.\w])(readTextFile|writeTextFile|readFile|writeFile|readDir|rename|mkdir|exists|stat)\(/);
  });
});
