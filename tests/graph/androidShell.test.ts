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
