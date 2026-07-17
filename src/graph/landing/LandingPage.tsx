import { LandingGraph } from "./LandingGraph";
import { SocketDot } from "../components/SocketLegend";
import { SOCKET_COLORS } from "../sockets";
import { TablePopup } from "../components/TablePopup";
import pkg from "../../../package.json";
import "./LandingPage.css";

// ─── The landing page (?landing) ────────────────────────────────────────────────
// A standalone route: App.tsx swaps the whole app for this page when the URL
// carries ?landing, same mechanism as the ?showcase harness. Copy follows the
// house voice (DESIGN.md §7); the hero tagline and body are the shipped About
// text. The graph in the hero is the real rete stack — see LandingGraph.tsx.

const GITHUB_URL = "https://github.com/bubba8587/solenoid";

type Feature = { title: string; body: React.ReactNode; figure?: React.ReactNode };

const FEATURES: Feature[] = [
  {
    title: "Excel parity",
    body: (
      <>
        Functions keep their Excel names and their Excel answers: <code>SUM</code>,{" "}
        <code>XLOOKUP</code>, <code>SUMIFS</code>, <code>NORM.DIST</code>, <code>PMT</code>.
        A built-in reference lists every function with its Excel equivalent.
      </>
    ),
  },
  {
    title: "Typed sockets",
    body: (
      <>
        Color says what a cable carries and shape says its dimension: a circle is one
        value, a square is a list, a grid is a table. A text output will not wire into
        a number input. Cast is the explicit conversion.
      </>
    ),
    figure: (
      <span className="sol-landing__glyphs">
        <SocketDot entry={{ kind: "circle", color: SOCKET_COLORS.number, tip: "Number" }} />
        <SocketDot entry={{ kind: "square", color: SOCKET_COLORS.list, tip: "Number List" }} />
        <SocketDot entry={{ kind: "grid", color: SOCKET_COLORS.table, tip: "Matrix" }} />
        <SocketDot entry={{ kind: "circle", color: SOCKET_COLORS.string, tip: "Text" }} />
        <SocketDot entry={{ kind: "circle", color: SOCKET_COLORS.date, tip: "Date" }} />
        <SocketDot entry={{ kind: "frame", color: SOCKET_COLORS.frame, tip: "Frame" }} />
        <SocketDot entry={{ kind: "lambda", color: SOCKET_COLORS.lambda, tip: "LAMBDA" }} />
        <SocketDot entry={{ kind: "ring", color: SOCKET_COLORS.trueany, tip: "Anything" }} />
      </span>
    ),
  },
  {
    title: "Real units",
    body: (
      <>
        Values carry units. <code>SUM(5 km, 3)</code> is <code>8 km</code>, m × m is m²,
        and metres plus seconds fails with <code className="sol-landing__err">#UNIT!</code>{" "}
        instead of silently adding nonsense. The Format Controller sets a unit and
        Convert changes it.
      </>
    ),
  },
  {
    title: "Tables at scale",
    body: (
      <>
        Filter, Sort, Join, Group By, Pivot and the other relational verbs are nodes.
        In the desktop app they run on native Polars, and a chain of verbs executes
        as a single lazy query.
      </>
    ),
  },
  {
    title: "What-if analysis",
    body: (
      <>
        Goal Seek, Scenarios, Data Table and Monte Carlo. Give an input a spread and
        read the output as a distribution, from a seeded, reproducible sampler.
      </>
    ),
  },
  {
    title: "Reports",
    body: (
      <>
        A Report is a markdown document that embeds live values: scalars, tables,
        charts, equations. Dock it beside the canvas and it updates as the graph
        recomputes.
      </>
    ),
  },
];

export default function LandingPage() {
  return (
    <div className="sol-landing">
      <div className="sol-landing__inner">
        <header className="sol-landing__top">
          <span className="sol-landing__wordmark">Solenoid</span>
          <nav className="sol-landing__nav">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href="./">Open the app</a>
          </nav>
        </header>

        <main>
          <section className="sol-landing__hero">
            <h1>A node-graph alternative to Excel for data tables.</h1>
            <p>
              Each node is one operation, and typed cables carry values between them:
              scalars, lists, tables, and frames. The graph recomputes as its inputs
              change, so the steps of a calculation stay visible on the canvas.
            </p>
            <div className="sol-landing__actions">
              <a className="sol-landing__cta sol-landing__cta--primary" href="./">
                Open Solenoid
              </a>
              <a className="sol-landing__cta" href={`${GITHUB_URL}/releases/latest`} target="_blank" rel="noreferrer">
                Download for Windows
              </a>
            </div>
          </section>

          <section className="sol-landing__demo">
            <LandingGraph />
            <p className="sol-landing__demo-note">
              This graph is live. Drag a card, or edit a value and the payout recomputes.
            </p>
          </section>

          <section className="sol-landing__features">
            {FEATURES.map((f) => (
              <article key={f.title} className="sol-landing__feature">
                <h2>{f.title}</h2>
                <p>{f.body}</p>
                {f.figure}
              </article>
            ))}
          </section>
        </main>

        <footer className="sol-landing__footer">
          <span>Solenoid {pkg.version}</span>
          <span aria-hidden="true">·</span>
          <span>MIT license</span>
          <span aria-hidden="true">·</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <span aria-hidden="true">·</span>
          <span>Built with Rete, Polars and Tauri.</span>
        </footer>
      </div>
      {/* The value popup a chip on the demo graph can open. */}
      <TablePopup />
    </div>
  );
}
