// [[C2]] realCanvasScenes
import { useEffect } from "react";
import { SiteHeader, SiteFooter } from "./siteNav";
import { Reveal, useRevealAnim } from "./LandingScenes";
import "./LandingPage.css";
import "./SitePages.css";

// The /examples route: a gallery of the graphs that ship in the app under the New from
// example menu. Group heads and item names are the seeds' own labels (seeds.ts), so the
// page and the in-app menu read the same. Each tile deep-links /?seed=<id>, which opens
// the template as a new document (FlowCanvas boot). Static DOM; chrome comes from siteNav.

// Curated from the seed library (src/graph/seedGraphs); the id is the JSON file's stem.
// Internal seeds (Getting started, Scratch, Script tour) are left out.
const GALLERY: { head: string; items: { id: string; label: string }[] }[] = [
  {
    head: "Obsidian",
    items: [
      { id: "vault-as-a-table", label: "Your vault as a table" },
      { id: "tasks-from-tasknotes", label: "Tasks from TaskNotes" },
      { id: "kitchen-remodel-tasknotes", label: "Kitchen remodel from TaskNotes" },
    ],
  },
  {
    head: "Tables",
    items: [
      { id: "table-verbs", label: "Table verbs" },
      { id: "computed-columns", label: "Computed columns & @" },
      { id: "record-cards", label: "Record cards" },
      { id: "cubes", label: "Cubes: nested tables" },
    ],
  },
  {
    head: "Values & units",
    items: [
      { id: "dimensional-flow", label: "Types & shapes" },
      { id: "null-and-logical", label: "Errors, null & logic" },
      { id: "unit-flow", label: "Unit flow" },
    ],
  },
  {
    head: "Modeling",
    items: [
      { id: "equation-solver", label: "Equation: solve either way" },
      { id: "composite-workbench", label: "Composite workbench" },
    ],
  },
  {
    head: "Charts & reports",
    items: [
      { id: "chart-showcase", label: "Charts & visuals" },
      { id: "garden-dashboard", label: "Garden dashboard" },
      { id: "report-showcase", label: "Report showcase" },
    ],
  },
  {
    head: "Worked examples",
    items: [
      { id: "personal-finance", label: "Personal finance" },
      { id: "decision-matrix", label: "Decision Matrix" },
      { id: "allocator", label: "Budget Allocator" },
      { id: "planners", label: "Planners" },
      { id: "famous-math", label: "Famous math" },
      { id: "product-launch-gantt", label: "Product launch (Gantt)" },
      { id: "sudoku-solver", label: "Sudoku solver" },
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
                {/* NEW COPY. */}
                <p>
                  Every graph below ships in the app. Open one to load it on your canvas and take
                  it apart. Your own documents stay where they are.
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
                  {group.items.map((item) => (
                    <a key={item.id} href={`/?seed=${item.id}`} className="sol-gallery__card">
                      <span className="sol-gallery__card-name">{item.label}</span>
                      <span className="sol-gallery__card-open" aria-hidden="true">Open →</span>
                    </a>
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
