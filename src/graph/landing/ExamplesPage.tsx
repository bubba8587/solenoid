// [[C2]] realCanvasScenes, [[B14]] oneDesignSystem (DESIGN.md § Voice)
import { useEffect } from "react";
import { SiteHeader, SiteFooter } from "./siteNav";
import { Reveal, useRevealAnim } from "./LandingScenes";
import "./LandingPage.css";
import "./SitePages.css";
import { SEEDS, SEED_GROUPS } from "../seeds";

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

          {SEED_GROUPS.map((group, i) => (
            <section key={group.head} className="sol-landing__section sol-gallery">
              <Reveal>
                <h2>{group.head}</h2>
              </Reveal>
              <Reveal delay={i === 0 ? 90 : 0}>
                <div className="sol-gallery__grid">
                  {group.ids.map((id) => (
                    <a key={id} href={`/?seed=${id}`} className="sol-gallery__card">
                      <span className="sol-gallery__card-name">{SEEDS[id].label}</span>
                      <span className="sol-gallery__card-open" aria-hidden="true">Open →</span>
                    </a>
                  ))}
                </div>
              </Reveal>
            </section>
          ))}

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
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
