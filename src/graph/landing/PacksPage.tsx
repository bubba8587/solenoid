import { useEffect } from "react";
import { SiteHeader, SiteFooter } from "./siteNav";
import { Reveal, useRevealAnim } from "./LandingScenes";
import "./LandingPage.css";
import "./SitePages.css";

// The /packs route: the domain node/function packs, which otherwise surface only as
// Settings toggles. Names, group heads, descriptions and the on-by-default flag mirror
// the pack definitions (src/graph/packs); keep them in step. Static DOM; chrome from siteNav.

// Grouped by the Settings ▸ Packs accordion. Descriptions are the packs' own text.
const PACKS: { head: string; items: { name: string; description: string; on?: boolean }[] }[] = [
  {
    head: "Everyday",
    items: [
      {
        name: "Geometry",
        on: true,
        description:
          "Geometric helpers: hypotenuse, the any-three-parts Triangle Solver, circles and arcs, solids. On by default. Turn off to declutter.",
      },
      {
        name: "Common Excel Timesavers",
        on: true,
        description:
          "Solenoid conveniences that aren't single Excel functions (rolling aggregates, weighted stats, list utilities, extended logic, percent change and CAGR, text cleanup, Reverse Text, Spell Number…). On by default. Turn off to declutter.",
      },
      {
        name: "Health & Fitness",
        description:
          "Body and fitness formulas: BMI, body surface area, BMR/TDEE, body-fat estimates (Deurenberg, US Navy), the heart-rate zone table, VO₂max, ideal body weight, creatinine clearance. Metric inputs. Estimates, not medical advice.",
      },
      {
        name: "Sets & Membership",
        description:
          "List membership and counting: Is In (per-element membership mask, the ISNUMBER(MATCH()) idiom), Tally (value counts as a table), and the COUNT DISTINCT aggregate. The Join node's semi or anti modes are the table-level counterparts.",
      },
    ],
  },
  {
    head: "Analysis",
    items: [
      {
        name: "Scientific Computing",
        description:
          "Signal processing and numerical methods: FFT spectrum, smoothing, peak finding, convolution, ODE integration, linear-system solve, eigenvalues, polynomial roots, distribution fitting, and seasonal decomposition.",
      },
      {
        name: "Data Science",
        description:
          "Machine learning and nonparametric statistics: K-Means, PCA, logistic regression, and the Kruskal-Wallis, Mann-Whitney, Wilcoxon, Fisher exact, and Kolmogorov-Smirnov tests.",
      },
    ],
  },
  {
    head: "Science & Engineering",
    items: [
      {
        name: "Electricity & Circuits",
        description:
          "Everyday electrical engineering: Ohm's law and power, dividers, reactance and resonance, RC or RL transients, decibels, the resistor color-code decoder, E-series component values, and AWG wire properties. SI units.",
      },
      {
        name: "Electromagnetism",
        description:
          "Fields, forces, waves, and induction: Coulomb's law, capacitance and inductance from geometry, magnetic fields, Lorentz force, photons, skin depth, Faraday's law, the EM spectrum band namer, and the CODATA physical-constants node. Builds on Electricity & Circuits.",
      },
      {
        name: "Fluid Mechanics",
        description:
          "Pipe flow, pumps, and aero classics: Reynolds number, the pipe-roughness table, Colebrook or Swamee–Jain friction factors, Darcy–Weisbach and Hazen–Williams losses, Bernoulli, orifice and pump power, Stokes settling, drag, speed of sound. SI units.",
      },
      {
        name: "Thermodynamics & Air",
        description:
          "Ideal gas, heat transfer (conduction/convection/radiation, R or U values), and humid-air psychrometrics (dew point, wet bulb, heat index, wind chill), plus the 1976 standard atmosphere and Antoine vapor-pressure nodes.",
      },
      {
        name: "Earth & Sky",
        description:
          "Navigation and astronomy: great-circle distance and bearing, gravity by latitude, horizon distance, orbital mechanics (Kepler, escape velocity), sun position and sunrise/sunset (NOAA), and moon phase.",
      },
      {
        name: "Chemistry Basics",
        description:
          "The periodic table as a node, molar mass from a typed formula (parentheses and hydrates included), and the lab-bench set: moles/molarity/dilution, pH, Nernst, Arrhenius, Gibbs, Beer–Lambert, radioactive decay.",
      },
    ],
  },
];

export default function PacksPage() {
  const anim = useRevealAnim();
  useEffect(() => {
    document.title = "Solenoid · Packs";
  }, []);

  return (
    <div className={`sol-landing${anim ? " sol-landing--anim" : ""}`}>
      <div className="sol-landing__inner">
        <SiteHeader current="/packs" />

        <main>
          <section className="sol-landing__hero sol-landing__hero--solo">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <h1>Packs</h1>
              </Reveal>
              <Reveal delay={110}>
                {/* NEW COPY. "Settings ▸ Packs" is the in-app location. */}
                <p>
                  Packs add nodes and functions for a domain. Geometry and the Excel timesavers
                  are on out of the box; turn the rest on under Settings ▸ Packs. Every pack keeps
                  its functions on the Formula surface and its units on the Format Controller.
                </p>
              </Reveal>
            </div>
          </section>

          {PACKS.map((group, i) => (
            <section key={group.head} className="sol-landing__section sol-packs">
              <Reveal>
                <h2>{group.head}</h2>
              </Reveal>
              <Reveal delay={i === 0 ? 90 : 0}>
                <div className="sol-packs__grid">
                  {group.items.map((pack) => (
                    <div key={pack.name} className="sol-packs__card">
                      <div className="sol-packs__card-head">
                        <h3>{pack.name}</h3>
                        {pack.on && <span className="sol-packs__badge">On by default</span>}
                      </div>
                      <p>{pack.description}</p>
                    </div>
                  ))}
                </div>
              </Reveal>
            </section>
          ))}

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              {/* NEW COPY. */}
              <p>Turn on the packs you need under Settings ▸ Packs. The rest stay out of your way.</p>
              <div className="sol-landing__actions">
                <a className="sol-landing__cta sol-landing__cta--primary" href="/">Open Solenoid</a>
                <a className="sol-landing__cta" href="/examples">Examples</a>
              </div>
            </Reveal>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
