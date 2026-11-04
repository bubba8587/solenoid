// [[B2]] webTryDesktopFull, [[live-connections#The demo vault]]
import { describe, it, expect } from "vitest";
import { relativeTo, chooseFile } from "../../src/graph/chooseFile";
import { filePicker } from "../../src/graph/filePickerStore";

describe("relativeTo", () => {
  it("answers the path inside the root, the root itself as empty, and nothing outside", () => {
    expect(relativeTo("/home/a/vault", "/home/a/vault/notes/x.md")).toBe("notes/x.md");
    expect(relativeTo("/home/a/vault/", "/home/a/vault")).toBe("");
    expect(relativeTo("/home/a/vault", "/home/a/vaultish/x.md")).toBeNull();
    expect(relativeTo("/home/a/vault", "/home/b/x.md")).toBeNull();
  });
  it("reads Windows paths with either slash and without case", () => {
    expect(relativeTo("C:\\Users\\A\\Data", "c:\\users\\a\\data\\sub\\f.csv")).toBe("sub/f.csv");
    expect(relativeTo("C:/Users/A/Data", "C:\\Users\\A\\Data")).toBe("");
  });
});

describe("chooseFile off the desktop", () => {
  it("opens the app's picker and resolves with its answer, null when it closes", async () => {
    const asked = chooseFile({ title: "Choose a note", root: "/vault", list: async () => ["a.md"] });
    expect(filePicker.get()?.title).toBe("Choose a note");
    filePicker.get()!.answer("a.md");
    expect(await asked).toBe("a.md");
    expect(filePicker.get()).toBeNull();
    const cancelled = chooseFile({ title: "Choose a note", root: "/vault", list: async () => [] });
    filePicker.get()!.answer(null);
    expect(await cancelled).toBeNull();
  });
  it("a second ask closes the first as cancelled", async () => {
    const first = chooseFile({ title: "One", root: "/v", list: async () => [] });
    const second = chooseFile({ title: "Two", root: "/v", list: async () => [] });
    expect(await first).toBeNull();
    expect(filePicker.get()?.title).toBe("Two");
    filePicker.get()!.answer(null);
    expect(await second).toBeNull();
  });
});
