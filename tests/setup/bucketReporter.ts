// [[engineering#Checks]]: the end of every run says, per area of the app (tests/buckets.mjs), whether it was checked
// and passed, which tests broke it, or that the run left it out, so a reader sees what a run covered without counts.
import path from "node:path";
import type { Reporter, TestModule } from "vitest/node";
// @ts-expect-error a plain ES module the runner script reads too
import { TIERS, domainOf } from "../buckets.mjs";

const AREAS: Record<string, string> = {
  engine: "the graph model, the pass, sockets and types",
  values: "errors, dates, units and formats",
  formulas: "the formula language and its functions",
  frames: "tables, cubes and their verbs",
  documents: "saving, the text form, the examples, the workspace",
  canvas: "layout, cables, gestures, the canvas",
  ui: "menus, search, popups, settings",
  figures: "charts, the Gantt, the scheduler, records",
  integrations: "Obsidian, files, the network, scripts, AI",
  nodes: "every card and pack",
  meta: "the repository's rules, docs, site and build",
};
const SHOWN = 5;

type Area = { ran: boolean; failed: string[] };

export default class BucketReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: { config: { root: string } }) {
    this.root = vitest.config.root;
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>) {
    const areas = new Map<string, Area>();
    for (const m of modules) {
      const file = path.relative(this.root, m.moduleId).replace(/\\/g, "/");
      const domain: string = domainOf(file) ?? "unclaimed";
      const a = areas.get(domain) ?? { ran: false, failed: [] };
      for (const test of m.children.allTests()) {
        const state = test.result().state;
        if (state === "passed") a.ran = true;
        if (state === "failed") a.failed.push(`${path.basename(file)} > ${test.fullName}`);
      }
      areas.set(domain, a);
    }
    if (!areas.size) return;
    const order = [...Object.values(TIERS as Record<string, string[]>).flat(), "unclaimed"];
    const broken = order.filter((d) => areas.get(d)?.failed.length);
    const left = order.filter((d) => d !== "unclaimed" && !areas.get(d)?.ran && !areas.get(d)?.failed.length);
    const head = broken.length
      ? ` ✗ ${broken.length} area${broken.length > 1 ? "s" : ""} broke`
      : left.length ? " ✓ every area this run checked passed" : " ✓ every area passed";
    const lines = ["", head];
    for (const d of order) {
      const a = areas.get(d);
      const name = (d === "ui" ? "UI" : d === "nodes" ? "Cards" : d[0].toUpperCase() + d.slice(1)).padEnd(13);
      const about = AREAS[d] ?? "test files no rule in tests/buckets.mjs claims";
      if (a?.failed.length) {
        lines.push(`   ✗ ${name}${about}: ${a.failed.length} failed`);
        for (const t of a.failed.slice(0, SHOWN)) lines.push(`       ${t}`);
        if (a.failed.length > SHOWN) lines.push(`       and ${a.failed.length - SHOWN} more`);
      } else if (a?.ran) lines.push(`   ✓ ${name}${about}`);
      else if (d !== "unclaimed") lines.push(`   · ${name}not run`);
    }
    console.log(lines.join("\n"));
  }
}
