import { useSyncExternalStore } from "react";
import { LandingGraph, LandingDiorama } from "./LandingGraph";
import { SocketDot, type SocketGlyph } from "../components/SocketLegend";
import { SOCKET_COLORS } from "../sockets";
import { TablePopup } from "../components/TablePopup";
import { appThemeStore } from "../appTheme";
import wordmark from "../../logo/solenoidwordmark.svg";
import icon from "../../logo/solenoidicon.svg";
import pkg from "../../../package.json";
import "./LandingPage.css";

// ─── The landing page (?landing) ────────────────────────────────────────────────
// A standalone route: App.tsx swaps the whole app for this page when the URL
// carries ?landing, same mechanism as the ?showcase harness. Copy follows the
// house voice (DESIGN.md §7); the hero tagline and body are the shipped About
// text. Both demo stages are the real rete stack — see LandingGraph.tsx.

const GITHUB_URL = "https://github.com/bubba8587/solenoid";

type Feature = { title: string; glyph: SocketGlyph; body: React.ReactNode };

// Each card's glyph is the REAL socket dot of the value family the feature
// works in — the same color-means-type rule the canvas uses.
const FEATURES: Feature[] = [
  {
    title: "Real units",
    glyph: { kind: "circle", color: SOCKET_COLORS.number },
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
    title: "Equation solver",
    glyph: { kind: "lambda", color: SOCKET_COLORS.lambda },
    body: (
      <>
        Type <code>V = I * R</code> and every variable is an input and an output. Wire
        any two and the third is solved, symbolically where it can be, numerically
        where it can't. A quadratic returns every real root.
      </>
    ),
  },
  {
    title: "Draw your data",
    glyph: { kind: "grid", color: SOCKET_COLORS.table },
    body: (
      <>
        Point Plotter turns clicks on a plane into X and Y lists, Curve samples a
        draggable spline into a list, and Grid Painter fills a matrix with a value
        brush. Sketch a dataset, then run real math on it.
      </>
    ),
  },
  {
    title: "Monte Carlo",
    glyph: { kind: "square", color: SOCKET_COLORS.list },
    body: (
      <>
        Give a composite's inputs a ± spread and its outputs come back as
        distributions: mean ± deviation with a histogram, from a seeded, reproducible
        sampler. Goal Seek, Scenarios and Data Table sit alongside it.
      </>
    ),
  },
  {
    title: "Obsidian, both directions",
    glyph: { kind: "document", color: SOCKET_COLORS.document },
    body: (
      <>
        Import a vault note as a live, typed source: its frontmatter becomes output
        sockets, and Reload re-reads from disk. Notes and Reports write back as
        portable markdown with real tables, math, and rendered chart images.
      </>
    ),
  },
  {
    title: "Presenter mode",
    glyph: { kind: "chart", color: SOCKET_COLORS.chart },
    body: (
      <>
        A Presentation node runs the canvas as a slideshow. The camera flies to each
        step's nodes, the chrome hides, and a click advances. The canvas is the slide.
      </>
    ),
  },
];

function ThemeToggle() {
  const mode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  const dark = mode === "dark";
  return (
    <button
      className="sol-landing__theme"
      onClick={() => appThemeStore.toggleMode()}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? (
        // Sun: the light theme this click switches to.
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="3.25" />
          <path d="M8 1.2v1.8 M8 13v1.8 M1.2 8h1.8 M13 8h1.8 M3.2 3.2l1.3 1.3 M11.5 11.5l1.3 1.3 M12.8 3.2l-1.3 1.3 M4.5 11.5l-1.3 1.3" />
        </svg>
      ) : (
        // Moon: the dark theme this click switches to.
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z" />
        </svg>
      )}
    </button>
  );
}

export default function LandingPage() {
  // The diorama snapshot bakes theme colors into its chart canvases, so a theme
  // switch remounts it (key) and it re-renders in the new theme.
  const mode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  return (
    <div className="sol-landing">
      <div className="sol-landing__inner">
        <header className="sol-landing__top">
          <span className="sol-landing__brand">
            <span
              className="sol-landing__mark"
              role="img"
              aria-hidden="true"
              style={{ WebkitMaskImage: `url("${icon}")`, maskImage: `url("${icon}")` }}
            />
            <span
              className="sol-landing__wordmark"
              role="img"
              aria-label="Solenoid"
              style={{ WebkitMaskImage: `url("${wordmark}")`, maskImage: `url("${wordmark}")` }}
            />
          </span>
          <nav className="sol-landing__nav">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href="./">Open the app</a>
            <ThemeToggle />
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

          <section className="sol-landing__demo sol-landing__demo--titled">
            <h2>Terrain and fields</h2>
            <p className="sol-landing__demo-lede">
              Grid Interpolate fills the holes in a sparse survey table with a smooth
              surface. Surface draws the filled grid as a shaded 3-D mesh and Contour
              draws the map view of the same heights.
            </p>
            <LandingDiorama key={mode} />
          </section>

          <section className="sol-landing__features">
            {FEATURES.map((f) => (
              <article key={f.title} className="sol-landing__feature">
                <h2>
                  <SocketDot entry={f.glyph} />
                  {f.title}
                </h2>
                <p>{f.body}</p>
              </article>
            ))}
          </section>

          <section className="sol-landing__strip">
            <p>
              Functions keep their Excel names and their Excel answers: <code>SUM</code>,{" "}
              <code>XLOOKUP</code>, <code>SUMIFS</code>, <code>NORM.DIST</code>, <code>PMT</code>.
              The built-in reference lists every one with its Excel equivalent.
            </p>
            <a className="sol-landing__cta sol-landing__cta--primary" href="./">Open Solenoid</a>
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
      {/* The value popup a chip on a demo graph can open. */}
      <TablePopup />
    </div>
  );
}
