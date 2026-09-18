// [[C2]] realCanvasScenes, [[B3]] sameNodeEverywhere, [[B14]] oneDesignSystem (DESIGN.md § Voice)
import { LandingGraph } from "./LandingGraph";
import { SocketLegendRows } from "../components/SocketLegend";
import { TablePopup } from "../components/TablePopup";
import { GITHUB_URL, HOME_HREF, SiteHeader, SiteFooter, Feature } from "./siteNav";
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

// A standalone route App.tsx swaps the whole app for under ?landing. The hero is the
// ONE live stage; motion is gated on a `--anim` class set after mount, so content
// never depends on a transition firing. Chrome comes from siteNav.

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
              Filter, Sort, Join, Group By, Append, Distinct, Pivot, Unpivot. 
               The desktop build runs data table functions via Rust + Polars,
              handling million-row operations with ease.
            </p>
          </Feature>

          <Feature title="Draw your data" flip scene={<DrawScene />}>
            <p>
              Solenoid includes a variety of interactive, visual widget nodes for data input. 
            </p>
          </Feature>

          <Feature title="YAML Frontmatter Inputs" scene={<ObsidianScene />}>
            <p>
              Author or import Markdown documents with frontmatter properties to use them
              as real inputs in your graph.
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
                Solenoid functions use Excel names, syntax, and math.  
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

        <SiteFooter />
      </div>
      <TablePopup />
    </div>
  );
}
