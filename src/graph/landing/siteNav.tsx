// [[C2]] realCanvasScenes
// Shared chrome for the marketing site (the /?landing, /obsidian, /download and
// /examples routes). Every page renders the same header, nav and footer from here, so
// the site reads as one place and a new page is a route entry plus a page file. Each
// route is a plain pathname; navigation is ordinary anchors (a full reload, the way the
// pages already cross-link), which Vercel rewrites back to index.html.
import { useSyncExternalStore, type ReactNode } from "react";
import { appThemeStore } from "../appTheme";
import wordmark from "../../logo/solenoidwordmark.svg";
import pkg from "../../../package.json";
import { Reveal } from "./LandingScenes";

export const GITHUB_URL = "https://github.com/bubba8587/solenoid";

// The home page is the overview, served under ?landing (root is the app itself).
export const HOME_HREF = "/?landing";

// The primary nav, in order. The wordmark covers Home, so it stays out of this list.
export const SITE_NAV: { href: string; label: string }[] = [
  { href: "/obsidian", label: "Obsidian" },
  { href: "/examples", label: "Examples" },
  { href: "/packs", label: "Packs" },
  { href: "/download", label: "Download" },
];

export function ThemeToggle() {
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

/** The site header: wordmark to Home, the primary nav, GitHub, Open the app, theme.
 *  `current` is the active route's pathname, marked in the nav. */
export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sol-landing__top">
      <a href={HOME_HREF} aria-label="Solenoid">
        <span
          className="sol-landing__wordmark"
          role="img"
          aria-label="Solenoid"
          style={{ WebkitMaskImage: `url("${wordmark}")`, maskImage: `url("${wordmark}")` }}
        />
      </a>
      <nav className="sol-landing__nav">
        {SITE_NAV.map((r) => (
          <a
            key={r.href}
            href={r.href}
            className={current === r.href ? "is-current" : undefined}
            aria-current={current === r.href ? "page" : undefined}
          >
            {r.label}
          </a>
        ))}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        <a href="/" className="sol-landing__nav-app">Open the app</a>
        <ThemeToggle />
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="sol-landing__footer">
      <span>Solenoid {pkg.version}</span>
      <span aria-hidden="true">·</span>
      <span>MIT license</span>
      <span aria-hidden="true">·</span>
      <a href={HOME_HREF}>What is Solenoid?</a>
      <span aria-hidden="true">·</span>
      <a href="/obsidian">Obsidian</a>
      <span aria-hidden="true">·</span>
      <a href="/examples">Examples</a>
      <span aria-hidden="true">·</span>
      <a href="/packs">Packs</a>
      <span aria-hidden="true">·</span>
      <a href="/download">Download</a>
      <span aria-hidden="true">·</span>
      <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
    </footer>
  );
}

/** A deep-feature row: copy beside a scene, alternating side by `flip`. Shared by the
 *  landing and Obsidian pages. */
export function Feature({
  title,
  flip,
  scene,
  children,
}: {
  title: string;
  flip?: boolean;
  scene: ReactNode;
  children: ReactNode;
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
