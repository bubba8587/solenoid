# Google developer style guide — fetched arbiter corpus

Plain-text extractions of the Google developer documentation style guide, fetched
2026-08-18. These are the ARBITER for the UI-copy register experiment (author,
2026-08-18): word-level style calls check against these files, never against model
memory — a from-memory pass invented a rule source and missed the articles rule
entirely. For that experiment the author has ruled these standards OVERRIDE
DESIGN.md §7 where they conflict; ASD-STE100 was evaluated the same day and dropped.

Each `<name>.txt` extracts the `<article>` body of
`https://developers.google.com/style/<name>`. `word-list.txt` is the main arbiter
(the full A–Z dictionary). `/style/ui-messages` is a 404 — error-message voice is
NOT part of this guide (that guidance is Material Design's, a different property).

Refetch (WebFetch fabricates on this site — use curl with a browser UA, per the
CLAUDE.md environment notes):

    curl -sL -A "Mozilla/5.0 ... Chrome/126.0 Safari/537.36" \
      https://developers.google.com/style/<name>

then strip to the `<article>…</article>` text.

Content © Google, licensed CC BY 4.0 (site content license); kept here as working
reference excerpts with attribution.
