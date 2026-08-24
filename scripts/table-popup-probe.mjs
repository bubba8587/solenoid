// Table/Cube popup virtualization DECIDER — DOM-cost probe (backlog: "Virtualize the
// table/cube popups"). Agent-run measurement, per the backlog line, NOT the build.
//
// What it measures and WHY this shape:
//   TablePopup renders at most MAX_VISIBLE_ROWS = 1000 rows (a 50k-row frame is sorted then
//   sliced to 1000 — see TablePopup.tsx). EVERY cell is an <input> — read-only popups render
//   <input readOnly>, not plain text (TablePopup.tsx ~942). So the real decider questions are:
//     (1) how long to build+lay-out 1000 × N <input> cells (time-to-open floor), and
//     (2) is the <input> the cost vs plain text (the thing virtualization OR a text-cell
//         rewrite would each remove)?
//   Cells are NOT memoized, so a keystroke's setGrid re-runs visibleOrder.map and React
//   reconciles all 1000×N cells; the DOM-side of that (rebuild the tbody subtree) is measured
//   as "rebuild". A pure value-only touch (set .value on every input) is measured as "retouch"
//   — the cheapest a keystroke could be if cells were memoized to their own value.
//
//   Runs on the REAL dev-server page (localhost:1420) so the app's own .table-popup__input
//   stylesheet drives layout cost. Pure timing; no visual assertion.
//
//   node scripts/table-popup-probe.mjs
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:1420";
const ROWS = 1000;              // the popup's MAX_VISIBLE_ROWS cap
const COLS = [3, 10, 30];       // the three column widths the decider asks for
const REPS = 7;                 // per (variant, cols); report the median
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

async function main() {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1600,1100"] });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    // Give the app's CSS a beat to attach (.table-popup__* rules live in the bundle).
    await new Promise((r) => setTimeout(r, 1500));

    const results = await page.evaluate(async (ROWS, COLS, REPS) => {
      const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
      // Mirror TablePopup's cell DOM. variant: "ro" = <input readOnly>, "edit" = <input>,
      // "text" = plain text in the <td> (the hypothetical non-input read-only cell).
      function buildTbody(rows, cols, variant) {
        const tbody = document.createElement("tbody");
        for (let r = 0; r < rows; r++) {
          const tr = document.createElement("tr");
          const th = document.createElement("th");
          th.className = "table-popup__rowhead"; th.textContent = String(r + 1);
          tr.appendChild(th);
          for (let c = 0; c < cols; c++) {
            const td = document.createElement("td");
            td.className = "table-popup__cell";
            if (variant === "text") {
              td.textContent = "123.45";
            } else {
              const inp = document.createElement("input");
              inp.className = "table-popup__input";
              inp.value = "123.45";
              inp.spellcheck = false;
              if (variant === "ro") inp.readOnly = true;
              td.appendChild(inp);
            }
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        return tbody;
      }

      // A mounted, popup-sized host so layout is real but off to the side.
      const host = document.createElement("div");
      host.className = "table-popup";
      host.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:640px;overflow:auto;contain:strict";
      const table = document.createElement("table");
      table.className = "table-popup__table";
      host.appendChild(table);
      document.body.appendChild(host);

      const out = {};
      for (const cols of COLS) {
        for (const variant of ["ro", "edit", "text"]) {
          const build = [], rebuild = [], retouch = [];
          for (let rep = 0; rep < REPS; rep++) {
            // BUILD: create the subtree + attach + force layout (time-to-open floor).
            while (table.firstChild) table.removeChild(table.firstChild);
            let t0 = performance.now();
            let tb = buildTbody(ROWS, cols, variant);
            table.appendChild(tb);
            void host.offsetHeight;                 // force sync layout
            build.push(performance.now() - t0);

            // RETOUCH: value-only update of every input (memoized-keystroke floor).
            if (variant !== "text") {
              t0 = performance.now();
              const inputs = table.querySelectorAll("input");
              for (let i = 0; i < inputs.length; i++) inputs[i].value = "678.90";
              void host.offsetHeight;
              retouch.push(performance.now() - t0);
            }

            // REBUILD: replace the whole tbody (non-memoized-keystroke DOM floor).
            t0 = performance.now();
            const nb = buildTbody(ROWS, cols, variant);
            table.replaceChild(nb, tb);
            void host.offsetHeight;
            rebuild.push(performance.now() - t0);
          }
          out[`c${cols}_${variant}`] = {
            cols, variant, cells: ROWS * cols,
            build_ms: +median(build).toFixed(1),
            retouch_ms: variant === "text" ? null : +median(retouch).toFixed(1),
            rebuild_ms: +median(rebuild).toFixed(1),
          };
        }
      }
      document.body.removeChild(host);
      return out;
    }, ROWS, COLS, REPS);

    // Print a compact table.
    console.log(`\nTablePopup DOM-cost probe — ${ROWS} rows (the MAX_VISIBLE_ROWS cap), median of ${REPS}\n`);
    console.log("cols  variant  cells    build(open)  retouch(memo-keystroke)  rebuild(current-keystroke)");
    for (const cols of COLS) {
      for (const variant of ["ro", "edit", "text"]) {
        const r = results[`c${cols}_${variant}`];
        const name = { ro: "input-ro", edit: "input-ed", text: "plaintext" }[variant];
        console.log(
          `${String(cols).padEnd(5)} ${name.padEnd(8)} ${String(r.cells).padEnd(8)} ` +
          `${String(r.build_ms).padStart(8)} ms   ${(r.retouch_ms == null ? "     — " : String(r.retouch_ms).padStart(7) + " ms").padStart(10)}            ${String(r.rebuild_ms).padStart(7)} ms`
        );
      }
    }
    console.log("\nJSON:", JSON.stringify(results));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
