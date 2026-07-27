import { useEffect, useState, useSyncExternalStore } from "react";
import { LandingGraph } from "./LandingGraph";
import { SocketLegendRows, DimensionalityFlow } from "../components/SocketLegend";
import { TablePopup } from "../components/TablePopup";
import { appThemeStore } from "../appTheme";
import wordmark from "../../logo/solenoidwordmark.svg";
import pkg from "../../../package.json";
import {
  Reveal,
  AnatomyScene,
  CableBoardScene,
  UnitsScene,
  EquationScene,
  VerbsScene,
  DrawScene,
  MonteCarloScene,
  ObsidianScene,
  PresenterScene,
  FnWall,
} from "./LandingScenes";
import "./LandingPage.css";

// ─── The landing page (?landing) ────────────────────────────────────────────────
// A standalone route: App.tsx swaps the whole app for this page when the URL
// carries ?landing, same mechanism as the ?showcase harness. Copy follows the
// house voice (DESIGN.md §7). The hero demo is the ONE live rete stage (see
// LandingGraph.tsx); every other illustration is a static vignette built from
// the app's real design recipes (LandingScenes.tsx). Motion is gated on a
// `--anim` root class set on mount, so content never depends on a transition
// firing, and prefers-reduced-motion gets the page with no entrance motion.

const GITHUB_URL = "https://github.com/bubba8587/solenoid";

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

/** A deep-feature section: copy on one side, a scene on the other, alternating. */
function Feature({
  title,
  flip,
  scene,
  children,
}: {
  title: string;
  flip?: boolean;
  scene: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`sol-landing__deep${flip ? " sol-landing__deep--flip" : ""}`}>
      <Reveal className="sol-landing__deep-copy">
        <h2>{title}</h2>
        {children}
      </Reveal>
      <Reveal className="sol-landing__deep-scene" delay={90}>
        {scene}
      </Reveal>
    </section>
  );
}

export default function LandingPage() {
  // The animation gate: entrance/loop motion exists only under this class, set
  // after mount and only when the OS doesn't ask for reduced motion.
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAnim(true);
  }, []);

  return (
    <div className={`sol-landing${anim ? " sol-landing--anim" : ""}`}>
      <div className="sol-landing__inner">
        <header className="sol-landing__top">
          <span
            className="sol-landing__wordmark"
            role="img"
            aria-label="Solenoid"
            style={{ WebkitMaskImage: `url("${wordmark}")`, maskImage: `url("${wordmark}")` }}
          />
          <nav className="sol-landing__nav">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href="./">Open the app</a>
            <ThemeToggle />
          </nav>
        </header>

        <main>
          <section className="sol-landing__hero">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <h1>A node-graph alternative to Excel for data tables.</h1>
              </Reveal>
              <Reveal delay={110}>
                <p>
                  Each node is one operation, and typed cables carry values between them:
                  scalars, lists, tables, and frames. The graph recomputes as its inputs
                  change, so the steps of a calculation stay visible on the canvas.
                </p>
              </Reveal>
              <Reveal delay={220}>
                <div className="sol-landing__actions">
                  <a className="sol-landing__cta sol-landing__cta--primary" href="./">
                    Open Solenoid
                  </a>
                  <a className="sol-landing__cta" href={`${GITHUB_URL}/releases/latest`} target="_blank" rel="noreferrer">
                    Download for Windows
                  </a>
                </div>
              </Reveal>
            </div>
            <Reveal className="sol-landing__hero-legend" delay={260}>
              <div className="sol-landing__hero-legend-heading">Socket types</div>
              <SocketLegendRows />
            </Reveal>
          </section>

          <section className="sol-landing__demo">
            <Reveal>
              <LandingGraph />
              <p className="sol-landing__demo-note">
                This graph is live. Grid Interpolate fills the holes in the sparse survey
                grid; Surface draws the mesh and Contour the map view. Drag a card, rotate
                the view from the pad on the Surface card, or open the table and edit a
                height.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>How a node reads</h2>
              <p className="sol-landing__lede">
                Every node is the same small card, and every part of the card means one
                thing. Once you can read one node, you can read a whole model.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <AnatomyScene />
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Typed sockets and cables</h2>
              <p className="sol-landing__lede">
                A cable&apos;s color tells you what flows through it, and endpoints only
                connect where the types agree. Element families never cross silently:
                text never becomes a number without a Cast, and a table never collapses
                into a scalar. The one bridge is boolean to number, because TRUE is 1.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <CableBoardScene />
            </Reveal>
            <Reveal delay={140} className="sol-landing__dimflow">
              <DimensionalityFlow />
            </Reveal>
          </section>

          <Feature title="Real units" scene={<UnitsScene />}>
            <p>
              Values carry units, not labels. <code>5 km</code> is stored as a base-SI
              quantity with a display unit, so <code>SUM(5 km, 3)</code> is{" "}
              <code>8 km</code> and m × m is m². The Format Controller sets a unit,
              Convert changes it, and the unit rides the value through every passthrough.
            </p>
            <p>
              Adding meters to seconds fails with{" "}
              <code className="sol-landing__err">#UNIT!</code> at the node where it
              happened, not three steps later as a plausible-looking number. Frame
              columns carry units too: a <code>Price ($)</code> header locks the column,
              and joins match 5 km against 5,000 m.
            </p>
          </Feature>

          <Feature title="The Equation node" flip scene={<EquationScene />}>
            <p>
              Type a relation and every variable is both an input and an output. Wire
              any two of <code>V = I × R</code> and the third is solved: symbolically
              where isolation works, numerically where it doesn&apos;t. A quadratic
              returns every real root.
            </p>
            <p>
              When everything is known, the Check output reports whether the values
              actually satisfy the relation. Domain packs ship locked equations for
              circuits, gases, chemistry and finance; the TVM node is one of them, so
              PMT, PV, FV, NPER and RATE are one card with the unknown solved.
            </p>
          </Feature>

          <Feature title="Relational verbs" scene={<VerbsScene />}>
            <p>
              Filter, Sort, Join, Group By, Append, Distinct, Pivot, Unpivot: the full
              verb set as nodes, with as-of joins for nearest-match on time. On the
              desktop build the verbs run on native Polars, and a chain is fused into
              one lazy plan, so a million-row frame costs one round trip instead of one
              per node.
            </p>
            <p>
              On the web the same verbs run a reference engine with identical answers.
              Sketch mode samples 10,000 rows while you edit and marks approximate
              results with ≈; F9 runs the exact pass.
            </p>
          </Feature>

          <Feature title="Draw your data" flip scene={<DrawScene />}>
            <p>
              Point Plotter turns clicks on a plane into X and Y lists. Curve samples a
              draggable spline into a list. Grid Painter fills a matrix with a value
              brush. Sketch the shape you have in mind, then run real math on it.
            </p>
          </Feature>

          <Feature title="What-if analysis" scene={<MonteCarloScene />}>
            <p>
              Give a model&apos;s inputs a ± spread and its outputs come back as
              distributions: mean, deviation and a histogram, from a seeded,
              reproducible sampler. Goal Seek drives an input until an output hits a
              target. Scenarios save named input sets, and Data Table sweeps a range.
            </p>
            <p>
              A model check fuzzes the leaf inputs and reports where the model breaks,
              and a Tornado node sweeps each input one at a time to show which one the
              result actually depends on.
            </p>
          </Feature>

          <Feature title="Obsidian, both directions" flip scene={<ObsidianScene />}>
            <p>
              Import a vault note as a live, typed source: its frontmatter keys become
              output sockets, and Reload re-reads from disk. A plain note works too;
              any note whose body opens with a YAML block is a typed record.
            </p>
            <p>
              Notes and Reports write back as portable markdown with real tables, math
              and rendered chart images, so the vault stays the home of the numbers.
            </p>
          </Feature>

          <Feature title="Reports and presenter mode" scene={<PresenterScene />}>
            <p>
              A Report is a markdown document that embeds live values: an inline{" "}
              <code>`=name`</code> renders a scalar, a scrollable table, a chart or a
              typeset equation, and updates when the graph does. Dock it to the right
              and the canvas stays live beside it.
            </p>
            <p>
              A Presentation node runs the canvas as a slideshow. The camera flies to
              each step&apos;s nodes, the chrome hides, and a click advances. The canvas
              is the slide.
            </p>
          </Feature>

          <section className="sol-landing__section sol-landing__parity">
            <Reveal>
              <h2>Excel parity</h2>
              <p className="sol-landing__lede">
                Functions keep their Excel names and their Excel answers. The built-in
                reference lists every function with its Excel equivalent, and search
                scores against the names you already know.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <FnWall />
            </Reveal>
          </section>

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              <p>
                Free and open source. Runs in the browser, or as a Windows desktop app
                with the native Polars engine.
              </p>
              <div className="sol-landing__actions">
                <a className="sol-landing__cta sol-landing__cta--primary" href="./">Open Solenoid</a>
                <a className="sol-landing__cta" href={`${GITHUB_URL}/releases/latest`} target="_blank" rel="noreferrer">
                  Download for Windows
                </a>
              </div>
            </Reveal>
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
