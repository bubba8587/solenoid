// [[B2]] webTryDesktopFull: the Android shell's own logic (docs/android.md).
import { describe, it, expect } from "vitest";
import { somethingToClose } from "../../src/graph/androidBack";
import { withExtension } from "../../src/graph/components/FilePicker";

const doc = (found: boolean) => ({ querySelector: () => (found ? ({} as Element) : null) }) as unknown as Pick<Document, "querySelector">;

describe("the back gesture closes what is open first", () => {
  it("nothing open: back leaves the app", () => {
    expect(somethingToClose(doc(false))).toBe(false);
  });
  it("a dialog or menu that handles its own Escape counts", () => {
    expect(somethingToClose(doc(true))).toBe(true);
  });
});

describe("Save As names the file once with its extension", () => {
  it("adds the extension when missing and keeps it when typed", () => {
    expect(withExtension("Budget", "json")).toBe("Budget.json");
    expect(withExtension("Budget.json", "json")).toBe("Budget.json");
    expect(withExtension("Budget.JSON", "json")).toBe("Budget.JSON");
    expect(withExtension("Budget.csv", "json")).toBe("Budget.csv.json");
  });
  it("a slash can't send the file to another folder, and a blank name is no name", () => {
    expect(withExtension("../x", "csv")).toBe("..x.csv");
    expect(withExtension("   ", "csv")).toBe("");
  });
});

describe("Android granted folders: paths and names", async () => {
  const { isTreePath, treeLabel, joinTree } = await import("../../src/graph/androidFolders");
  const { vaultName } = await import("../../src/graph/obsidianLinks");
  const vault = "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FVault";
  it("a tree address, and a path under it, are granted-folder paths; a disk path isn't", () => {
    expect(isTreePath(vault)).toBe(true);
    expect(isTreePath(`${vault}/Daily/a.md`)).toBe(true);
    expect(isTreePath("/home/me/Vault")).toBe(false);
  });
  it("reads as the folder on the phone, an SD card's as such", () => {
    expect(treeLabel(vault)).toBe("Documents/Vault");
    expect(treeLabel(`${vault}/Daily/a.md`)).toBe("Documents/Vault/Daily/a.md");
    expect(treeLabel("content://com.android.externalstorage.documents/tree/primary%3A")).toBe("Phone");
    expect(treeLabel("content://com.android.externalstorage.documents/tree/1A2B-3C4D%3AData")).toBe("SD card/Data");
  });
  it("joins without folding content://", () => {
    expect(joinTree(vault, "Daily", "a.md")).toBe(`${vault}/Daily/a.md`);
    expect(joinTree(`${vault}/`, "/Daily/", "a.md")).toBe(`${vault}/Daily/a.md`);
  });
  it("an Obsidian link names the vault by its folder, not its address", () => {
    expect(vaultName(vault)).toBe("Vault");
  });
});
