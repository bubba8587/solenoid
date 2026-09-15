import { useEffect } from "react";
import { SiteHeader, SiteFooter } from "./siteNav";
import { Reveal, useRevealAnim } from "./LandingScenes";
import "./LandingPage.css";
import "./SitePages.css";

// The /examples route: a gallery of the graphs that ship in the app under the New from
// example menu. Group heads and item names are the seeds' own labels (seeds.ts), so the
// page and the in-app menu read the same. Static DOM only; chrome comes from siteNav.
// Note: not yet deep-linked into the app; a ?seed= entry point is the obvious next step.

// Curated from the seed library (src/graph/seedGraphs). Labels and group heads are the
// seeds' own; internal seeds (Getting started, Scratch, Script tour) are left out.
const GALLERY: { head: string; items: string[] }[] = [
  {
    head: "Obsidian",
    items: [
      "Your vault as a table",
      "Tasks: list and tracked time",
      "Write it back to Obsidian",
      "Daily notes as a time series",
      "Kitchen remodel from TaskNotes",
    ],
  },
  {
    head: "Tables",
    items: [
      "Pivot tables",
      "Table verbs",
      "Computed columns & @",
      "LAMBDA helpers",
      "Record cards",
      "Cubes: nested tables",
    ],
  },
  {
    head: "Values & units",
    items: [
      "Types & shapes",
      "Errors, null & logic",
      "Trust & data quality",
      "Units by dimension",
      "Unit flow",
    ],
  },
  {
    head: "Modeling",
    items: ["Equation: solve either way", "Composite workbench"],
  },
  {
    head: "Charts & reports",
    items: [
      "Charts & visuals",
      "Live market data",
      "Garden dashboard",
      "Report showcase",
      "Mail merge",
    ],
  },
  {
    head: "Worked examples",
    items: [
      "Personal finance",
      "Decision Matrix",
      "Which task next?",
      "Budget Allocator",
      "Balance a team's hours",
      "Trip split",
      "Debt payoff",
      "Remodel (Gantt)",
      "Famous math",
      "Project (two frames)",
      "Earned Value",
      "Product launch (Gantt)",
      "Sudoku solver",
    ],
  },
];

export default function ExamplesPage() {
  const anim = useRevealAnim();
  useEffect(() => {
    document.title = "Solenoid · Examples";
  }, []);

  return (
    <div className={`sol-landing${anim ? " sol-landing--anim" : ""}`}>
      <div className="sol-landing__inner">
        <SiteHeader current="/examples" />

        <main>
          <section className="sol-landing__hero sol-landing__hero--solo">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <h1>Examples</h1>
              </Reveal>
              <Reveal delay={110}>
                {/* NEW COPY. "New from example" is the in-app menu label. */}
                <p>
                  Every graph below ships in the app. Open one from the New from example menu and
                  take it apart.
                </p>
              </Reveal>
              <Reveal delay={220}>
                <div className="sol-landing__actions">
                  <a className="sol-landing__cta sol-landing__cta--primary" href="/">Open Solenoid</a>
                </div>
              </Reveal>
            </div>
          </section>

          {GALLERY.map((group, i) => (
            <section key={group.head} className="sol-landing__section sol-gallery">
              <Reveal>
                <h2>{group.head}</h2>
              </Reveal>
              <Reveal delay={i === 0 ? 90 : 0}>
                <div className="sol-gallery__grid">
                  {group.items.map((name) => (
                    <div key={name} className="sol-gallery__card">
                      {name}
                    </div>
                  ))}
                </div>
              </Reveal>
            </section>
          ))}

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              {/* NEW COPY. */}
              <p>Open any of these from New from example, or start from a blank canvas.</p>
              <div className="sol-landing__actions">
                <a className="sol-landing__cta sol-landing__cta--primary" href="/">Open Solenoid</a>
                <a className="sol-landing__cta" href="/download">Download</a>
              </div>
            </Reveal>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
