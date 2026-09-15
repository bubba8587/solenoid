// dte:C2
import { useSyncExternalStore } from "react";
import { LandingGraph } from "./LandingGraph";
import { SocketLegendRows, DimensionalityFlow } from "../components/SocketLegend";
import { TablePopup } from "../components/TablePopup";
import { appThemeStore } from "../appTheme";
import wordmark from "../../logo/solenoidwordmark.svg";
import pkg from "../../../package.json";
import {
  Reveal,
  useRevealAnim,
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

// A standalone route App.tsx swaps the whole app for under ?landing. The hero is the
// ONE live rete stage; motion is gated on a `--anim` class set after mount, so content
// never depends on a transition firing.

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
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="3.25" />
          <path d="M8 1.2v1.8 M8 13v1.8 M1.2 8h1.8 M13 8h1.8 M3.2 3.2l1.3 1.3 M11.5 11.5l1.3 1.3 M12.8 3.2l-1.3 1.3 M4.5 11.5l-1.3 1.3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z" />
        </svg>
      )}
    </button>
  );
}

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
  const anim = useRevealAnim();

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
                <h1>Your workbooks, now in node-graph form.</h1>
              </Reveal>
              <Reveal delay={110}>
                <p>
                  Build your spreadsheets piece by piece. Solenoid makes wiring up complex spreadsheet operations fast 
                  and easy to understand. 
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
                This graph is live. Try editing the input table or rotating the 3D figure.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Typed sockets and cables</h2>
              <p className="sol-landing__lede">
                Sockets and cables are all colored according to their value type. Value
                types and dimensions are preserved so you'll
                never confuse a date with a number or text value.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <CableBoardScene />
            </Reveal>
            <Reveal delay={140} className="sol-landing__dimflow">
              <DimensionalityFlow />
            </Reveal>
          </section>

          <Feature title="Units" scene={<UnitsScene />}>
            <p>
              Values carry real units - not just annotations - everywhere they can.
            </p>
            <p> 
              {" "}<code>SUM(5 km, 3)</code> is <code>8 km</code>, <code>2 m × 4 m </code>
               makes <code>8 m²</code>.
            </p>
          </Feature>

          <Feature title="Solve for any variable" flip scene={<EquationScene />}>
            <p>
              Instead of setting up the same equation rearranged 3 different ways, just use
              Solenoid's Equation node. Plug in all but one variable and it solves for the remaining one.
              Limited support for multiple quadratic roots.
            </p>
          </Feature>

          <Feature title="Relational verbs" scene={<VerbsScene />}>
            <p>
              Filter, Sort, Join, Group By, Append, Distinct, Pivot, Unpivot: the full
              relational verb set. The desktop build runs on Rust and Polars, so it
              handles million-row operations with ease.
            </p>
          </Feature>

          <Feature title="Draw your data" flip scene={<DrawScene />}>
            <p>
              Draw your inputs by hand: plot points, sketch a curve, or paint a grid.
              Then run the math on them.
            </p>
          </Feature>

          <Feature title="What-if analysis" scene={<MonteCarloScene />}>
            <p>
              Give a model&apos;s inputs a ± spread and its outputs come back as
              distributions, with a mean, a spread and a histogram.
            </p>
          </Feature>

          <Feature title="YAML Frontmatter Inputs" flip scene={<ObsidianScene />}>
            <p>
              Author or import Markdown documents with frontmatter properties to use them
              as real inputs in your graph.
            </p>
          </Feature>

          <Feature title="Live documents and slideshows" scene={<PresenterScene />}>
            <p>
              Write a live document that pulls values from the graph: a number, a table,
              a chart or a typeset equation, each updating as the data changes.
            </p>
            <p>
              Or present the canvas itself as a slideshow, the view flying from one step
              to the next.
            </p>
          </Feature>

          <section className="sol-landing__section sol-landing__parity">
            <Reveal>
              <h2>Excel parity</h2>
              <p className="sol-landing__lede">
                Functions keep their Excel names and their Excel answers.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <FnWall />
            </Reveal>
          </section>

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              <p>
                Free and open source. Runs in the browser, or as a Windows desktop app.
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
      <TablePopup />
    </div>
  );
}
