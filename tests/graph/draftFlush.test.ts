// [[C95]] commitOnEnter, [[B12]] losslessSaves
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flushDrafts, registerPendingDraft } from "../../src/graph/draftFlush";

describe("open drafts flush before a capture", () => {
  it("commits every registered draft once, and a failing one never blocks the rest", () => {
    const log: string[] = [];
    registerPendingDraft({}, () => { throw new Error("boom"); });
    registerPendingDraft({}, () => log.push("note"));
    expect(flushDrafts()).toBe(true);
    expect(log).toEqual(["note"]);
    expect(flushDrafts()).toBe(false);
  });

  it("an unregistered draft does not flush", () => {
    const log: string[] = [];
    const off = registerPendingDraft({}, () => log.push("x"));
    off();
    expect(flushDrafts()).toBe(false);
    expect(log).toEqual([]);
  });

  it("a switch, a file save and the page closing flush; the idle autosave keeps the draft local", () => {
    const store = readFileSync("src/graph/documentStore.ts", "utf8");
    expect(store).toMatch(/captureCurrent\(opts\?: \{ keepDrafts\?: boolean \}\): boolean \{[\s\S]{0,160}if \(!opts\?\.keepDrafts\) flushDrafts\(\);/);
    const persistence = readFileSync("src/graph/persistence.ts", "utf8");
    expect(persistence).toContain("documentStore.captureCurrent({ keepDrafts: true });");
    expect(persistence).toMatch(/"pagehide"[\s\S]{0,120}flushDrafts\(\)/);
    const session = readFileSync("src/graph/fileSession.ts", "utf8");
    expect(session.match(/flushDrafts\(\);/g)?.length).toBe(2);
    for (const f of ["components/inlineInput.tsx", "components/NoteNode.tsx", "components/ReportOverlay.tsx"]) {
      expect(readFileSync(`src/graph/${f}`, "utf8")).toContain("usePendingDraft(");
    }
  });
});
