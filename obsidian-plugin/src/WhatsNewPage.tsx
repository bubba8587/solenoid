// [[C107]] obsidianPlugin, [[obsidian-plugin#What's new]]
import { SLIDES } from "../../src/graph/whatsNewSlides";
import { WHATS_NEW_VERSION } from "../../src/graph/helpDialogStore";
import type { PluginNotes } from "./pluginNotes";
import wordmark from "../../src/logo/solenoidwordmark.svg";
import "./WhatsNewPage.css";

const SITE = "https://solenoid-ngc.com";
const LINKS = [
  { text: "Open Solenoid", href: `${SITE}/`, accent: true },
  { text: "Download", href: `${SITE}/download`, accent: false },
  { text: "Solenoid and Obsidian", href: `${SITE}/obsidian`, accent: false },
];

function Links() {
  return (
    <div className="solenoid-whatsnew__links">
      {LINKS.map((l) => (
        <a key={l.href} className={`solenoid-whatsnew__btn${l.accent ? " solenoid-whatsnew__btn--accent" : ""}`} href={l.href} target="_blank" rel="noopener">
          {l.text}
        </a>
      ))}
    </div>
  );
}

export function WhatsNewPage({ version, notes }: { version: string; notes: PluginNotes | undefined }) {
  return (
    <div className="solenoid-whatsnew">
      {notes && (
        <section className="solenoid-whatsnew__plugin">
          <div className="solenoid-whatsnew__eyebrow">Solenoid Properties {version}</div>
          {notes.notes.map((n) => (
            <div key={n.title} className="solenoid-whatsnew__note">
              <div className="solenoid-whatsnew__note-title">{n.title}</div>
              <div className="solenoid-whatsnew__note-body">{n.body}</div>
            </div>
          ))}
        </section>
      )}
      <section className="solenoid-whatsnew__hero">
        <span className="solenoid-whatsnew__wordmark" role="img" aria-label="Solenoid" style={{ WebkitMaskImage: `url("${wordmark}")`, maskImage: `url("${wordmark}")` }} />
        <p className="solenoid-whatsnew__tagline">
          The chips and table editors in your properties come from Solenoid, a node-graph alternative to Excel for data tables.
          It reads your vault's notes and properties, so the tables you keep here can feed charts, pivots and dashboards there.
        </p>
        <Links />
      </section>
      <section>
        <div className="solenoid-whatsnew__eyebrow">What's new in Solenoid {WHATS_NEW_VERSION}</div>
        <div className="solenoid-whatsnew__slides">
          {SLIDES.map((s) => (
            <div key={s.title} className="solenoid-whatsnew__slide">
              <div className="solenoid-whatsnew__slide-title">{s.title}</div>
              <div className="solenoid-whatsnew__slide-body">{s.body}</div>
            </div>
          ))}
        </div>
      </section>
      <Links />
    </div>
  );
}
