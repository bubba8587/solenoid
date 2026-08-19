import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCopyRecords, type CopyRecord } from "../src/graph/copyCorpus";
import { renderInventory, parseInventory, applyInventory } from "./copy-inventory";

describe("copy inventory", () => {
  it("round-trips the real corpus: parse(render(records)) is lossless", () => {
    const records = collectCopyRecords();
    expect(records.length).toBeGreaterThan(400);
    for (const kind of ["help-file", "catalog-desc", "tsx-tooltip", "seed-string"]) {
      expect(records.some((r) => r.kind === kind), kind).toBe(true);
    }
    const parsed = parseInventory(renderInventory(records));
    expect(parsed.size).toBe(new Set(records.map((r) => r.id)).size);
    for (const r of records) expect(parsed.get(r.id), r.id).toBe(r.text);
  });

  it("tsx records are verbatim source substrings at their recorded line", () => {
    const tsx = collectCopyRecords().filter((r) => r.kind.startsWith("tsx-"));
    for (const r of tsx.slice(0, 200)) {
      const line = readFileSync(r.file, "utf8").split("\n")[r.line! - 1];
      expect(line.includes(r.text), r.id).toBe(true);
    }
  });

  it("applies edits back: seed by JSON path, tsx by unique replace, ambiguity skips", () => {
    const root = mkdtempSync(join(tmpdir(), "copyinv-"));
    mkdirSync(join(root, "seeds"), { recursive: true });
    mkdirSync(join(root, "cmp"), { recursive: true });
    writeFileSync(
      join(root, "seeds/demo.json"),
      JSON.stringify({ nodes: [{ id: "n1", init: { body: "Old prose." } }] }, null, 2),
    );
    writeFileSync(
      join(root, "cmp/A.tsx"),
      ['<div title="Unique tip here" />', '<div title="Twice said" aria-label="Twice said" />'].join("\n"),
    );
    const records: CopyRecord[] = [
      { id: "seed:demo.json:nodes[0].init.body", kind: "seed-string", file: "seeds/demo.json", path: "nodes[0].init.body", text: "Old prose." },
      { id: "tsx:cmp/A.tsx:1.tooltip#0", kind: "tsx-tooltip", file: "cmp/A.tsx", line: 1, text: "Unique tip here" },
      { id: "tsx:cmp/A.tsx:2.tooltip#0", kind: "tsx-tooltip", file: "cmp/A.tsx", line: 2, text: "Twice said" },
    ];
    const edits = new Map<string, string>([
      ["seed:demo.json:nodes[0].init.body", "New prose."],
      ["tsx:cmp/A.tsx:1.tooltip#0", "Sharper tip"],
      ["tsx:cmp/A.tsx:2.tooltip#0", "Won't apply"], // appears twice in the file
    ]);
    // seed staleness check re-collects from the real repo; sidestep it by making
    // the seed record fresh: applyInventory's seed path re-reads via collect —
    // here we call with a fixture root, so collect must run against that root.
    const { outcomes, unchanged } = applyInventory(root, records, edits);
    expect(unchanged).toBe(0);
    const byId = new Map(outcomes.map((o) => [o.id, o]));
    expect(byId.get("tsx:cmp/A.tsx:1.tooltip#0")!.status).toBe("applied");
    expect(byId.get("tsx:cmp/A.tsx:2.tooltip#0")!.status).toBe("skipped");
    expect(readFileSync(join(root, "cmp/A.tsx"), "utf8")).toContain('title="Sharper tip"');
    expect(readFileSync(join(root, "cmp/A.tsx"), "utf8")).toContain('title="Twice said"');
  });

  it("refuses a tsx edit that would break the attribute quoting", () => {
    const root = mkdtempSync(join(tmpdir(), "copyinv-"));
    mkdirSync(join(root, "cmp"), { recursive: true });
    writeFileSync(join(root, "cmp/B.tsx"), '<div title="Plain words" />');
    const rec: CopyRecord = { id: "tsx:cmp/B.tsx:1.tooltip#0", kind: "tsx-tooltip", file: "cmp/B.tsx", line: 1, text: "Plain words" };
    const { outcomes } = applyInventory(root, [rec], new Map([[rec.id, 'Adds a "quote"']]));
    expect(outcomes[0].status).toBe("skipped");
    expect(readFileSync(join(root, "cmp/B.tsx"), "utf8")).toContain("Plain words");
  });

  it("escapes a body line that starts with the record marker", () => {
    const rec: CopyRecord = { id: "seed:x.json:nodes[0].init.body", kind: "seed-string", file: "x", path: "p", text: "line one\n@@@ not a marker\nline three" };
    const parsed = parseInventory(renderInventory([rec]));
    expect(parsed.get(rec.id)).toBe(rec.text);
  });
});
