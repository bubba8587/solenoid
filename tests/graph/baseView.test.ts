import { describe, it, expect } from "vitest";
import { sanitizeBaseName, baseRelPath, buildBaseView } from "../../src/graph/baseView";

// Bundle 24 item B (writeBase) — the pure `<node>.base` Bases view builder.

describe("baseView", () => {
  it("path is beside the notes, sanitized", () => {
    expect(baseRelPath("Projects", "Write Properties")).toBe("Projects/Write Properties.base");
    expect(baseRelPath("", "Write Properties")).toBe("Write Properties.base");
    expect(sanitizeBaseName("a/b:c")).toBe("a-b-c");
  });

  it("a table view scoped to the folder, ordered by file.name then the keys", () => {
    const s = buildBaseView("Projects", ["status", "priority"], "Write Properties");
    expect(s).toContain("filters:\n  and:\n    - file.inFolder(\"Projects\")");
    expect(s).toContain("views:\n  - type: table\n    name: Write Properties");
    expect(s).toContain("    order:\n      - file.name\n      - status\n      - priority");
  });

  it("a blank folder scopes to the whole vault (no folder filter)", () => {
    const s = buildBaseView("", ["status"], "V");
    expect(s).not.toContain("filters:");
    expect(s).toContain("- file.name");
  });
});

describe("review pins: quoting", () => {
  it("a view name or key YAML would misread is quoted; the folder is JS-escaped", () => {
    const y = buildBaseView('Pro"jects', ["status", "due: date"], "Write: tasks");
    expect(y).toContain('file.inFolder("Pro\\"jects")');
    expect(y).toContain('name: "Write: tasks"');
    expect(y).toContain('- "due: date"');
    expect(y).toContain("- status\n");
  });
});
