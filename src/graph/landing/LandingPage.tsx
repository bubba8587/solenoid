// [[B3]] sameNodeEverywhere, [[B14]] oneDesignSystem (DESIGN.md § Voice)
import { LandingGraph } from "./LandingGraph";
import { SocketLegendRows } from "../components/SocketLegend";
import { TablePopup } from "../components/TablePopup";
import { HOME_HREF, SiteHeader, SiteFooter, Feature, DownloadLink } from "./siteNav";
import { SceneThread } from "./SceneThread";
import {
  Reveal,
  useRevealAnim,
  CableBoardScene,
  UnitsScene,
  EquationScene,
  VerbsScene,
  DrawScene,
  ObsidianScene,
  PresenterScene,
  FnWall,
} from "./LandingScenes";
import "./LandingPage.css";


export default function LandingPage() {
  const anim = useRevealAnim();

  return (
    <div className={`sol-landing${anim ? " sol-landing--anim" : ""}`}>
      <div className="sol-landing__inner">
        <SceneThread />
        <SiteHeader current={HOME_HREF} />

        <main>
          <section className="sol-landing__hero">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <h1>Your workbooks, now in node-graph form.</h1>
              </Reveal>
              <Reveal delay={110}>
                <p>
                  Build your spreadsheets piece by piece. Each step is a card on a canvas, wired
                  to the next, so a complex calculation stays easy to follow.
                </p>
              </Reveal>
              <Reveal delay={220}>
                <div className="sol-landing__actions">
                  <a className="sol-landing__cta sol-landing__cta--primary" href="./">
                    Open Solenoid
                  </a>
                  <DownloadLink />
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
                Sockets and cables are colored by value type. Types and dimensions carry
                through every step, so a date never passes for a number or a piece of text.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <CableBoardScene />
            </Reveal>
          </section>

          <Feature title="Units" scene={<UnitsScene />}>
            <p>
              Values carry real units through the math. <code>SUM(5 km, 3)</code> is{" "}
              <code>8 km</code>, and <code>2 m × 4 m</code> makes <code>8 m²</code>.
            </p>
          </Feature>

          <Feature title="Solve for any variable" flip scene={<EquationScene />}>
            <p>
              Write an equation once in the Equation node, with no rearranging. Fill in all
              but one variable and it solves for the one that's left. A quadratic gives both
              roots; any other equation with several solutions gives the one nearest zero.
            </p>
          </Feature>

          <Feature title="Relational verbs" scene={<VerbsScene />}>
            <p>
              Filter, Sort, Join, GROUPBY, Append, Distinct, Pivot and Unpivot. The desktop
              build runs them on Rust and Polars, fast enough for million-row tables.
            </p>
          </Feature>

          <Feature title="Draw your data" flip scene={<DrawScene />}>
            <p>
              Sketch a curve or place points by hand, and the graph reads them as data.
            </p>
          </Feature>

          <Feature title="Frontmatter inputs" scene={<ObsidianScene />}>
            <p>
              Write a Markdown note with frontmatter properties, or import one, and use each
              property as an input in the graph.
            </p>
          </Feature>

          <Feature title="Live documents and slideshows" flip scene={<PresenterScene />}>
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
                Solenoid's functions use Excel's names, syntax and math.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <FnWall />
            </Reveal>
          </section>

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              <p>
                Free and open source. Runs in the browser, or as a desktop app on Windows and Linux.
              </p>
              <div className="sol-landing__actions">
                <a className="sol-landing__cta sol-landing__cta--primary" href="./">Open Solenoid</a>
                <DownloadLink />
              </div>
            </Reveal>
          </section>
        </main>

        <SiteFooter />
      </div>
      <TablePopup />
    </div>
  );
}
