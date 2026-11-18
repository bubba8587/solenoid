// Runs `cargo test` with the arguments given, its output streaming as it would, then says what each test binary
// checks and whether it passed, naming the failed tests, as the vitest runs end (tests/setup/bucketReporter.ts).
//   node scripts/cargo-test.mjs --manifest-path crates/solenoid-core/Cargo.toml
//   node scripts/cargo-test.mjs --manifest-path crates/solenoid-core/Cargo.toml --release --test nodes
// On CI the summary is also written to the job's summary page ($GITHUB_STEP_SUMMARY). The exit code is cargo's.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const LABELS = {
  "solenoid-core": {
    unittests: "the checks inside the core's own source",
    "doc-tests": "the examples in the core's doc comments",
    aggregates_refuse_text: "SUM, AVERAGE and the other aggregates refuse text",
    caches: "the formula caches never mix up two LAMBDAs",
    calc_state: "an error in one engine call never leaks into the next",
    card_fuzz: "no card crashes on hostile text",
    card_helpers: "the Record card's shared helpers",
    conformance: "every frozen answer, replayed natively",
    corpus: "the frame-verb corpus",
    csv: "reading CSV text, hostile files included",
    date_fuzz: "date functions over random input",
    dates_before_1900: "dates before 1900",
    excel_doc_sweep: "Excel's documented answers (the sweep)",
    excel_examples: "Excel's documented answers (the examples)",
    expect_date_bounds: "Expect's date bounds",
    frame_aggregates_refuse_text: "table GroupBy and Pivot refuse text, as the formulas do",
    fuzz_formulas: "random formulas never crash or hang",
    grid_filters: "smoothing and grid filters answer as SciPy does",
    join_whole_rows: "joins keep whole rows",
    logic_refuses_text: "AND, OR and the other logic functions refuse text",
    logicals_in_aggregates: "how the aggregates count TRUE and FALSE",
    nodes: "every card body against its frozen answers",
    pivot_calc: "Pivot's calculated fields",
    pivot_totals: "Pivot's totals",
    pivot_value_names: "Pivot's value captions",
    plan_readers: "the Gantt plan-file readers",
    properties: "math laws between answers, over random cases",
    providers: "the live data providers' replies",
    qr: "QR codes",
    relative_dates: "relative dates (\"next Friday\")",
    scan_reduce: "SCAN agrees with REDUCE",
    unit_catalog: "the unit catalog",
    value_paths: "every value is read through its one path",
    xlsx: "reading an Excel workbook's Tables",
  },
  "solenoid-graph": {
    unittests: "the checks inside the graph core's own source",
    "doc-tests": "the examples in the graph core's doc comments",
    annotate: "the formats and units the resolver writes",
    boundary_core: "values crossing between the app and the core",
    conduit: "Conduit cards",
    fc: "Format cards and Convert",
    lattice: "which socket types connect",
    model: "the graph model: cards, cables and their signals",
    pass: "the calculation pass and finding loops",
    session: "calc modes and queued recalcs",
    settle: "socket types settling after an edit",
    text_form: "the text form of a saved graph",
  },
};

if (import.meta.url !== `file://${process.argv[1]}`) {
  // Imported (tests/graph/cargoLabels.test.ts): the labels only.
} else run();

function run() {
const args = process.argv.slice(2);
const mi = args.indexOf("--manifest-path");
const crate = path.basename(path.dirname(path.resolve(mi >= 0 ? args[mi + 1] : "Cargo.toml")));
const labels = LABELS[crate] ?? {};
const quote = (a) => `'${a.replace(/'/g, `'\\''`)}'`;
// One stream, so a binary's "Running" line (cargo's stderr) stays ahead of its results (the binary's stdout).
const child = spawn("sh", ["-c", `cargo test ${args.map(quote).join(" ")} 2>&1`], { stdio: ["inherit", "pipe", "inherit"] });

const bins = [];
let cur = null;
let buf = "";
let broke = false;
const line = (l) => {
  const run = l.match(/^\s+Running (unittests )?(\S+)/);
  const doc = l.match(/^\s+Doc-tests (\S+)/);
  if (run || doc) {
    const key = doc ? "doc-tests" : run[1] ? "unittests" : path.basename(run[2], ".rs");
    cur = { key, failed: [], result: null };
    bins.push(cur);
    return;
  }
  if (/^error(\[E\d+\])?: could not compile|^error: could not compile/.test(l)) broke = true;
  const fail = l.match(/^test (\S+) \.\.\. FAILED$/);
  if (fail && cur) cur.failed.push(fail[1]);
  const res = l.match(/^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/);
  if (res && cur) cur.result = { ok: res[1] === "ok", passed: +res[2], ignored: +res[4] };
};
child.stdout.on("data", (d) => {
  process.stdout.write(d);
  buf += d;
  const lines = buf.split("\n");
  buf = lines.pop();
  // CI colors cargo's own lines (CARGO_TERM_COLOR); the color codes go before a line is read.
  lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).forEach(line);
});

child.on("close", (code) => {
  if (buf) line(buf.replace(/\x1b\[[0-9;]*m/g, ""));
  const shown = bins.filter((b) => b.result && (b.result.passed || b.failed.length || !b.result.ok));
  const bad = shown.filter((b) => !b.result.ok);
  const head = broke
    ? ` ✗ ${crate} did not compile`
    : bad.length
      ? ` ✗ ${bad.length} ${crate} check${bad.length > 1 ? "s" : ""} broke`
      : code !== 0
        ? ` ✗ ${crate}: cargo test failed (exit ${code})`
        : ` ✓ every ${crate} check passed`;
  const rows = shown.map((b) => ({ ok: b.result.ok, name: b.key, about: labels[b.key] ?? `${b.key}.rs`, failed: b.failed }));
  const out = ["", head];
  for (const r of rows) {
    out.push(`   ${r.ok ? "✓" : "✗"} ${r.about}${r.ok ? "" : `: ${r.failed.length || "some"} failed`}  (${r.name})`);
    for (const t of r.failed.slice(0, 5)) out.push(`       ${t}`);
    if (r.failed.length > 5) out.push(`       and ${r.failed.length - 5} more`);
  }
  console.log(out.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`### ${head.trim()}`, "", ...rows.flatMap((r) => [
      `- ${r.ok ? "✓" : "✗"} ${r.about} \`${r.name}\`${r.ok ? "" : `: ${r.failed.length || "some"} failed`}`,
      ...r.failed.slice(0, 10).map((t) => `  - \`${t}\``),
    ]), ""];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
  }
  process.exit(code ?? 1);
});
}
