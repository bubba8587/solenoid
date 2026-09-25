// The cuts: each is a running order of scenes between an intro and an outro backdrop, its title-card copy and its
// output name. `compose.mjs <cut>` assembles one; `record.mjs <cut>` films its scenes. Copy follows DESIGN.md § Voice
// and reuses the landing pages' lines.
export const CUTS = {
  demo: {
    out: "solenoid-demo",
    intro: "intro",
    outro: "outro",
    order: [
      "build", "types", "units", "formula", "functions", "equation", "tables", "charts",
      "obs-look", "palettes", "obs-property", "import-pair", "sol-import", "sol-write", "obs-open",
    ],
    tagline: "Your workbooks, now in node-graph form.",
    end: {
      lead: "Free and open source.",
      sub: "Runs in the browser, or as a desktop app on Windows and Linux.",
      url: "solenoid-ngc.vercel.app",
    },
  },
  obsidian: {
    out: "solenoid-obsidian",
    intro: "pl-intro",
    outro: "pl-outro",
    order: ["pl-meeting", "pl-form", "pl-reload", "pl-write", "pl-look"],
    mark: "solenoidpropertieswordmark.svg",
    eyebrow: "For Obsidian",
    tagline: "The computation layer for your vault.",
    end: {
      lead: "Free in Obsidian's community plugins.",
      sub: "Solenoid itself is free and open source, in the browser or on Windows and Linux.",
      url: "solenoid-ngc.vercel.app/obsidian",
    },
    // Its backdrops are still screens, so compose.mjs pushes in on them.
    push: true,
  },
};

/** The scenes a cut films, in filming order: the outro backdrop last, since it shows where the story ends. */
export const cutScenes = (cut) => [cut.intro, ...cut.order, cut.outro];
