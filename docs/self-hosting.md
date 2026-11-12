# Self-hosting Solenoid inside a company

A proposal for the engineering team, 2026-11-12. Status: **proposed**. The xlsx Table reader (step 1) is built; the
deployment config (step 2) has its groundwork in; steps 3 and 4 are not started. Nothing here is ratified yet: the
product call (below) comes first.

## The use case

A company hosts the web build of Solenoid on an internal server, behind its intranet portal. Its workbooks
(`.xlsx`/`.xlsm`) live on the company's SharePoint. An employee opens the portal in a browser, opens a saved graph, and
the graph's source cards read those workbooks' tables, so the graph shows current numbers without anyone installing
anything or copying data by hand.

What this asks of the app:

1. The web build reads a workbook that sits on SharePoint (or another internal server), as the signed-in employee.
2. A graph file itself can be opened from a link, so "see and use the graph" is one click from the portal.
3. A company admin can configure the hosted copy once (sign-in, trusted sources) without forking the code.

What it does **not** ask: no Solenoid-run server, no hosted compute. Every browser still computes its own graph, and the
hosted copy is the same static build anyone can serve. That keeps it inside `docs/out-of-scope.md` §11 ("nothing in the
client requires the service"; "the relay is self-hostable"), but it is a new direction for who the web build is for, so
it needs the author's call recorded in the tree before steps 2 to 4 ship.

## Where the cards stand today

| | Desktop app | Web build |
|---|---|---|
| **Local File** (a file in the data folder set in Settings) | Reads CSV, Parquet, and now an xlsx Table | No file system. Only the bundled demo vault |
| **Web Source** (a URL) | Fetches any URL through the shell (no CORS) | Browser `fetch`: same-origin rules apply, no way to sign in |

So for the web build, Local File is out by design (a browser can't read a mapped SharePoint drive), and the work lands on
Web Source. In the browser it hits three walls:

1. **Authentication.** A SharePoint file needs the employee's Microsoft 365 sign-in. Web Source sends no credentials.
2. **CORS.** A page on `portal.company.com` can't read a response from `company.sharepoint.com` unless SharePoint says
   so, and SharePoint's file URLs don't. The card surfaces this as `CorsLikelyError` ("use the desktop app").
3. **Binary bodies.** Web Source reads text (CSV, JSON). A workbook is a zip, so it needs a bytes path into the core's
   xlsx reader. (Built in step 1.)

## Two ways to reach the files

### Route A: same-origin hosting (no Microsoft integration)

The company serves the app and the data from one origin, for example the app at `portal.company.com/solenoid/` and the
workbooks at `portal.company.com/data/`, with a reverse proxy in front of the file store. Then:

- CORS never applies, since the request is same-origin.
- The portal's existing sign-in (cookies, Windows integrated auth) rides along on the request automatically.
- Web Source with a relative or same-origin URL works, CSV today, xlsx with step 1.

This is the cheapest path, needs zero app changes beyond step 1, and is the only path for **on-premises SharePoint
Server**, which IT exposes through the proxy. The cost is on the company's side: someone configures the proxy.

### Route B: SharePoint Online through Microsoft Graph

Microsoft's sanctioned browser path to SharePoint Online and OneDrive is the Graph API:

- **Sign-in:** MSAL.js (`@azure/msal-browser`) runs the Microsoft sign-in popup and hands back a short-lived access token
  with delegated `Files.Read` (or `Sites.Read.All`) scope. The employee only ever sees files they could already open.
- **CORS:** Graph allows cross-origin browser requests with a bearer token.
- **Share links:** `GET /shares/{encoded-sharing-url}/driveItem/content` turns the link an employee copies from
  SharePoint into the file's bytes (a redirect to a pre-authenticated download URL). So the card's field stays "paste a
  link", not drive and item IDs.
- **One-time IT setup:** register an app in the company's Entra ID tenant (a single-page app with the portal's redirect
  URI), grant the delegated scope, and give the hosted copy the tenant ID and client ID (the deployment config, below).
  Roughly ten minutes for a tenant admin.

Graph also has an Excel API (`/workbook/tables/{name}/range`) that answers a named Table's values with Excel Online
recalculating server-side. **We don't use it**: downloading the file and reading it on the core means a workbook from
SharePoint, from disk and from a plain URL read through one code path and give one answer, and the Excel API's latency,
session handling and throttling stay out of the card. The one thing it would buy (a recalculation of formulas Excel never
saved an answer for) the reader handles by naming each such cell as an error instead (see the spec).

## What to build

### 1. xlsx Tables in Local File and Web Source (built)

Spec: `tree/specs/computation/live-connections.md` § Excel workbooks. In short: only **named Tables** (Insert → Table,
or Ctrl+T in Excel) are read, never a whole sheet or a typed range, since a Table has exact edges and a header row. The
answers are the values Excel saved with the file; a formula with no saved answer is a per-cell error naming the cell and
the formula. Column types come from the cells, and the popup's per-column type picks work as they do for CSV. Reader:
the `calamine` crate in `solenoid-core`, so it runs in the browser, the desktop app and the headless runner alike.

### 2. A deployment config (groundwork built)

An optional `solenoid.config.json` served next to `index.html`, read once at startup, absent in the public build.
Today it carries:

```json
{
  "trustedSources": ["portal.company.com", "company.sharepoint.com"]
}
```

- **`trustedSources`**: hosts whose fetches skip the network prompt. A graph opened from a shared location counts as
  someone else's document ([[engineering#Untrusted content]]), so every connection card asks "Allow it to fetch?" first.
  That's right for a file from the internet and noise for the company's own graph reading the company's own SharePoint.
  The list lets an admin vouch for named hosts only; a card in the same graph fetching anywhere else still asks. Host
  match is exact (no wildcards), lowercase, and a `.` prefix (`.company.com`) covers that domain and its subdomains;
  an entry may name a port (`files.company.com:8443`), which must then match. The public build ships this file with
  an empty list, so a company replaces one file and changes no code.

Planned additions for Route B:

```json
{
  "microsoft": { "tenantId": "…", "clientId": "…" }
}
```

Neither ID is a secret (a SPA registration has no client secret), so a static file is the right place.

### 3. Sign in with Microsoft (not started)

- A connection setting "Sign in with Microsoft", present only when the config names a tenant.
- MSAL holds the token in memory (session storage at most). **Never** in a graph file, Settings, or local storage: a
  shared graph must never carry anyone's access.
- Web Source recognizes a SharePoint or OneDrive link (`*.sharepoint.com`, `onedrive.live.com`, `1drv.ms`), resolves it
  through `/shares/…/driveItem/content`, and reads the bytes as any other workbook.
- Refresh and the refresh interval re-download; an expired token renews silently, and a failed renewal reads as the
  card's error ("Sign in again"), never as an empty table.
- Testing needs a Microsoft 365 developer tenant. Unit tests can cover the link encoding and the error paths without one.

### 4. Opening a graph from a link (not started)

`?doc=<url>` on the app's address loads a graph file from that URL (through the Microsoft sign-in when it's a
SharePoint link), opened as a foreign document with the trusted-source rule above. Saving back to SharePoint is out of
this step. This overlaps the cloud document library in `docs/v2.0/21-collaboration.md`; design the two together so a
document's identity and its "where it came from" are one idea, not two.

## Security notes

- The browser build already refuses nothing by address (only the desktop shell checks private ranges, [[B18]]
  safeToShare). Inside a company that's what we want for the user's own graphs; for a foreign graph the network prompt
  plus `trustedSources` is the gate.
- Tokens: in memory, scoped to read, never serialized. A graph file holds only links.
- The config file is served by the company, so it is trusted the way the app's own code is. It can only widen which
  hosts skip a prompt, never reach anything the browser couldn't already.
- No telemetry, no Solenoid-side service, as today.

## Open questions for the team

1. **The product call:** is "a company self-hosts the web build" a supported deployment? (Author decision, recorded as a
   leaf before steps 2 to 4 ship.)
2. **Google Workspace / Box / Dropbox:** same shape as Route B (OAuth popup, a files API with CORS). Worth a generic
   "connected drive" layer, or Microsoft only until someone asks?
3. **Freshness:** saved answers are as of the last save in Excel. Is that acceptable for the reporting use case, or does
   someone need Excel Online's recalculated values (the Graph Excel API) as an opt-in?
4. **Writing back:** reading only for now. A graph writing a table back into a workbook on SharePoint is a separate,
   larger piece (the file is the employee's, and Excel may have it open).
