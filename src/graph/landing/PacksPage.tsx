// [[C2]] realCanvasScenes, [[B15]] leanCore, [[B14]] oneDesignSystem (DESIGN.md § Voice)
import { useEffect } from "react";
import { SiteHeader, SiteFooter } from "./siteNav";
import { Reveal, useRevealAnim } from "./LandingScenes";
import "./LandingPage.css";
import "./SitePages.css";
import { BUILTIN_PACKS, PACK_GROUP_ORDER } from "../packs";

const PACK_GROUPS = PACK_GROUP_ORDER.map((head) => ({ head, packs: BUILTIN_PACKS.filter((p) => p.group === head) }));

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
                <p>
                  Packs add nodes and functions for a domain. Geometry and the Excel timesavers
                  are on out of the box; turn the rest on under Settings ▸ Packs. Every pack keeps
                  its functions on the Formula surface and its units on the Format Controller.
                </p>
              </Reveal>
            </div>
          </section>

          {PACK_GROUPS.map((group, i) => (
            <section key={group.head} className="sol-landing__section sol-packs">
              <Reveal>
                <h2>{group.head}</h2>
              </Reveal>
              <Reveal delay={i === 0 ? 90 : 0}>
                <div className="sol-packs__grid">
                  {group.packs.map((pack) => (
                    <div key={pack.id} className="sol-packs__card">
                      <div className="sol-packs__card-head">
                        <h3>{pack.name}</h3>
                        {pack.defaultActive && <span className="sol-packs__badge">On by default</span>}
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
