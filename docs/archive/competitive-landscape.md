# Solenoid — Competitive Landscape

## The core differentiation

Every significant tool in this space is built for one of two contexts: an organization publishing data to an audience, or an analyst querying a database their organization controls. The individual - someone with a personal question, personal variables, and no database of their own - is essentially unaddressed.

This project is a personal computation instrument. Not a team tool. Not an analytics platform. A local-first desktop app where one person wires together public data feeds and their own inputs to answer questions that are specific to them. That position doesn't exist in the current landscape.

The sharpest single differentiator: every tool below is built for organizations or technical professionals. This one is built for an individual with a question.

---

## Grafana

**What it does**: Visualization and dashboarding layer for observability data - server metrics, logs, traces, infrastructure health. Open source with a hosted cloud option.

**Why it seems relevant but isn't**: Grafana is fundamentally an engineering tool for monitoring systems you own and operate. It's designed for time-series data from Prometheus, InfluxDB, Loki - not public financial data feeds. Stretching it to business or civic data is possible but fighting the tool the whole way.

**The personal vs organizational gap**: Grafana assumes you're an engineer on a team monitoring shared infrastructure. There's no concept of a personal variable, no node graph computation model, no "my budget" input. You're always querying a database your organization controls.

**Where it wins**: Real-time infrastructure observability. If you're monitoring server health or application performance, nothing in this list touches it. Completely different problem space.

---

## Business Intelligence (Power BI, Tableau, Looker)

**What they do**: Connect to organizational databases, build dashboards, share reports across a team. Extremely powerful for organizations that own their data.

**The personal vs organizational gap**: These are organizational tools top to bottom. They assume a team, a shared data source, a governed semantic model, and an analyst who owns the pipeline. The individual with a personal question and no database doesn't fit anywhere in that model. You can't wire "my $50 budget" into a Power BI dashboard because the concept of a personal variable mixed into a computation simply doesn't exist.

**Why you'd use this instead**:
- Assume you control the data source - you don't. FEC data, a campaign's Google Sheet, a publisher's widget feed are all external read-only sources.
- Organizational pricing for organizational use. Power BI starts at $10-20/user/month, Tableau significantly more.
- No node graph model. Everything is query-driven, not composition-driven.
- Overkill in every direction for one person with one question.

**Where they win**: Organizations with a data warehouse and a team of analysts. This project isn't competing there.

---

## No-code automation (Zapier, Make/Integromat, n8n)

**What they do**: Node-based workflow automation. Trigger → action chains connecting APIs and services.

**Why you'd use this instead**:
- Automation tools are event/action oriented, not computation oriented. They move data between services, they don't compute personal answers from public data.
- No concept of a persistent personal graph you reason with over time.
- n8n is the closest in terms of node graph UX but it's fundamentally about automating tasks not answering questions.
- Server-side tools, not personal desktop instruments.

**Where they win**: Automating actions (post to Slack when X happens, sync spreadsheets). This project doesn't do automation.

---

## Spreadsheets (Excel, Google Sheets)

**What they do**: General purpose computation on tabular data you own or paste in.

**Why you'd use this instead**:
- Pull-based by nature - you manually update data or write your own import scripts. Live data connections are bolted on and fragile.
- The cell/formula model doesn't represent computation graphs well. Complex dependency chains become unmaintainable.
- No native concept of a typed live data feed from an external publisher.
- Sharing a graph means sharing a spreadsheet with all your personal data mixed in.

**Where they win**: Anything tabular and data-heavy. If your use case is mostly tables and you're comfortable with formulas, a spreadsheet is probably fine. This project is better suited to scalar values and personal reasoning graphs than bulk tabular analysis.

---

## Personal finance / budgeting tools (YNAB, Monarch, Copilot)

**What they do**: Connect to your financial accounts, categorize transactions, help you budget.

**Why you'd use this instead**:
- Entirely focused on your own financial data, no concept of external public data feeds.
- Closed ecosystems - you use their categories, their graphs, their insights.
- No computation model. You observe, you don't compute.
- Not designed for political or campaign finance data at all.

**Where they win**: Personal account aggregation and budgeting. Not really the same category.

---

## Node-based creative tools (Blender, TouchDesigner, Max/MSP)

**What they do**: Node graph computation for 3D rendering, realtime visuals, audio/MIDI processing.

**Why you'd use this instead**:
- Closest in interaction model and the direct UX inspiration. But domain-specific creative tools with no concept of live data feeds or financial data.
- TouchDesigner has a very similar philosophy - wire together sources and transformations into a live output - but entirely focused on audiovisual performance.

**Where they win**: Their specific domains entirely. The relevance here is purely as UX inspiration, not competition.

---

## Civic data / transparency tools (OpenSecrets, FollowTheMoney, ProPublica)

**What they do**: Publish political finance data in browsable, searchable web interfaces. Journalism-oriented.

**Why you'd use this instead**:
- Read-only browsing interfaces. You can look up a candidate's totals but you can't wire that number into a personal computation.
- No concept of a user-defined question or personal variable.
- Web-based, no desktop, no persistent personal state.
- Designed for journalists and researchers doing investigation, not individuals making decisions.

**Where they win**: Raw data access and investigative depth. This project consumes their data layer indirectly via FEC API but doesn't compete with the investigative use case.

---

## Observable / Jupyter notebooks

**What they do**: Computational notebooks for data analysis. Code-driven, highly flexible.

**Why you'd use this instead**:
- Require programming ability. A notebook is not a node graph.
- No live data feed concept out of the box - you write the ingestion yourself.
- Not a desktop app, not a persistent personal instrument.
- Observable in particular is browser-based and publishing-oriented.

**Where they win**: Anyone comfortable writing code can do everything this project does and more in a Jupyter notebook. The audience for this project explicitly doesn't want to write code.

---

## Summary matrix

| | Live public data feeds | Personal computation layer | Node graph UX | No account needed | Desktop | Free / low cost |
|---|---|---|---|---|---|---|
| **This project** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Grafana | ✗ (own data) | ✗ | ✗ | ✗ | ✗ | partial |
| Power BI | partial | ✗ | ✗ | ✗ | ✓ | ✗ |
| Tableau | partial | ✗ | ✗ | ✗ | ✓ | ✗ |
| n8n | ✓ | ✗ | ✓ | ✗ | ✗ | partial |
| Google Sheets | ✗ | partial | ✗ | ✗ | ✗ | ✓ |
| OpenSecrets | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |
| Jupyter | DIY | ✓ | ✗ | ✓ | ✓ | ✓ |
| TouchDesigner | ✗ | ✓ | ✓ | ✗ | ✓ | partial |

---

## The honest gap

No existing tool combines: curated live public data feeds + personal scalar inputs + node graph computation + local-first desktop + no account. That combination is the product. Each individual piece exists somewhere but the assembly doesn't.

The closest thing conceptually is a Jupyter notebook with a live data fetching library and a custom UI - which is roughly what this project is, minus the code requirement, plus the node graph interaction model.
