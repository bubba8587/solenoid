// [[C2]] realCanvasScenes, [[B2]] webTryDesktopFull, [[B14]] oneDesignSystem (DESIGN.md § Voice)
import { useEffect } from "react";
import { GITHUB_URL, SiteHeader, SiteFooter, DownloadLink } from "./siteNav";
import { Reveal, useRevealAnim } from "./LandingScenes";
import "./LandingPage.css";
import "./SitePages.css";

// The /download route: static DOM only; chrome comes from siteNav.

export default function DownloadPage() {
  const anim = useRevealAnim();
  useEffect(() => {
    document.title = "Solenoid · Download";
  }, []);

  return (
    <div className={`sol-landing${anim ? " sol-landing--anim" : ""}`}>
      <div className="sol-landing__inner">
        <SiteHeader current="/download" />

        <main>
          <section className="sol-landing__hero sol-landing__hero--solo">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <h1>Get Solenoid</h1>
              </Reveal>
              <Reveal delay={110}>
                <p>Free and open source. Runs in the browser, or as a desktop app on Windows and Linux.</p>
              </Reveal>
            </div>
          </section>

          <section className="sol-landing__section sol-get">
            <div className="sol-get__grid">
              <Reveal className="sol-get__card">
                <h2>In your browser</h2>
                <p>Runs in your browser, on desktop and mobile. Nothing to install.</p>
                <div className="sol-landing__actions">
                  <a className="sol-landing__cta sol-landing__cta--primary" href="/">Open Solenoid</a>
                </div>
              </Reveal>

              <Reveal className="sol-get__card" delay={90}>
                <h2>On your desktop</h2>
                <p>
                  The desktop app runs the relational verbs on a native Rust (Polars) engine for
                  memory-heavy tables. The web build uses an identical in-process JS engine.
                </p>
                <div className="sol-landing__actions">
                  <DownloadLink primary />
                </div>
              </Reveal>
            </div>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>What the desktop build adds</h2>
            </Reveal>
            <Reveal delay={90}>
              <ul className="sol-get__list">
                <li>
                  <strong>The native engine.</strong> Relational verbs run on Rust and Polars, for
                  million-row tables the browser would struggle with.
                </li>
                <li>
                  <strong>Obsidian vaults.</strong> Point Solenoid at a vault folder to import and
                  write notes directly to it.
                </li>
                <li>
                  <strong>Local files.</strong> Read a CSV from disk and write a table back out for
                  Excel to open.
                </li>
              </ul>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Build from source</h2>
            </Reveal>
            <Reveal delay={90}>
              <p className="sol-landing__lede">
                The web build needs only Node 20 and up. The desktop build additionally needs the
                Rust toolchain and Tauri&apos;s platform prerequisites. It builds on Windows and Linux.
              </p>
              <div className="sol-landing__actions">
                <a className="sol-landing__cta" href={GITHUB_URL} target="_blank" rel="noreferrer">
                  Source on GitHub
                </a>
              </div>
            </Reveal>
          </section>

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              <p>MIT licensed. No accounts, no cloud, no telemetry.</p>
              <div className="sol-landing__actions">
                <a className="sol-landing__cta sol-landing__cta--primary" href="/">Open Solenoid</a>
                <a className="sol-landing__cta" href="/?landing">What is Solenoid?</a>
              </div>
            </Reveal>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
