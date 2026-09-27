// Generator for the Cards demo: three linked CSVs in demo-vault/Data (crew, products, orders)
// and the "Cards from files" seed that reads them through Local File nodes and runs table verbs.
// Deterministic (a seeded PRNG), so a rerun rewrites the same bytes. Run with:
//   node scripts/gen-cards-demo.cjs
// then `npx vitest run tests/graph/seeds.test.ts` to validate the seed against the real classes.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "demo-vault", "Data");
const SEED = path.join(ROOT, "src", "graph", "seedGraphs", "cards-from-files.json");

let state = 0x5eed1e55;
function rand() {
  state |= 0; state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const round2 = (n) => Math.round(n * 100) / 100;

function csvField(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file, headers, rows) {
  const text = [headers, ...rows].map((r) => r.map(csvField).join(",")).join("\n") + "\n";
  fs.writeFileSync(path.join(DATA, file), text);
}
const svgData = (svg) => "data:image/svg+xml;base64," + Buffer.from(svg.replace(/\s+/g, " ").trim()).toString("base64");

function isoDate(serialFrom2026) {
  const d = new Date(Date.UTC(2026, 0, 1) + serialFrom2026 * 86400000);
  return d.toISOString().slice(0, 10);
}

// ── Crew: people cards with drawn avatars ─────────────────────────────────────
const CREW = [
  ["Ada", "Lovelace", "Engines", "London"], ["Alan", "Turing", "Codes", "Manchester"],
  ["Grace", "Hopper", "Compilers", "Arlington"], ["Edsger", "Dijkstra", "Codes", "Austin"],
  ["Katherine", "Johnson", "Orbits", "Hampton"], ["Margaret", "Hamilton", "Orbits", "Boston"],
  ["Claude", "Shannon", "Signals", "Princeton"], ["Barbara", "Liskov", "Compilers", "Cambridge"],
  ["Donald", "Knuth", "Codes", "Stanford"], ["Frances", "Allen", "Compilers", "Yorktown"],
  ["John", "McCarthy", "Engines", "Stanford"], ["Hedy", "Lamarr", "Signals", "Los Angeles"],
  ["Radia", "Perlman", "Signals", "Seattle"], ["Tim", "Berners-Lee", "Engines", "Geneva"],
  ["Mary", "Jackson", "Orbits", "Hampton"], ["Dennis", "Ritchie", "Compilers", "Murray Hill"],
];
const TEAM_SKILLS = {
  Engines: ["hardware", "math", "design", "writing"],
  Codes: ["crypto", "logic", "math", "research"],
  Compilers: ["compilers", "testing", "teaching", "logic"],
  Orbits: ["math", "orbits", "research", "testing"],
  Signals: ["networks", "research", "hardware", "crypto"],
};
const TEAM_BIOS = {
  Engines: ["Keeps the engine design notes and runs the Friday review.", "Builds the bench prototypes; ask before borrowing the good scope."],
  Codes: ["Owns the key rotation schedule and the incident runbook.", "Reviews every change to the cipher library."],
  Compilers: ["Leads the migration off the old build system, due this quarter.", "Mentors the new hires and writes most of the onboarding guide."],
  Orbits: ["Checks every trajectory by hand before it goes to the review board.", "Runs the launch window calendar."],
  Signals: ["Splits time between research and the support rota.", "Travels for the client workshops in spring and autumn."],
};
const HUES = ["#d94f3d", "#e0873a", "#d9a93b", "#8aab46", "#2fae7a", "#2aa3a3", "#3d7fd9", "#5b6ee1", "#8a63d2", "#c05dd1", "#d65c8f", "#7a8591"];

function avatar(first, last, hue) {
  const initials = `${first[0]}${last.replace(/[^A-Za-z]/g, "")[0]}`;
  return svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="10" fill="${hue}"/>
      <text x="32" y="41" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="700" fill="#fff">${initials}</text>
    </svg>`);
}

const crewRows = CREW.map(([first, last, team, city], i) => {
  const hue = HUES[i % HUES.length];
  const pool = TEAM_SKILLS[team];
  const skills = pool.filter(() => rand() < 0.55);
  if (skills.length === 0) skills.push(pool[0]);
  const start = between(0, 150);
  const end = rand() < 0.3 ? "" : isoDate(start + between(30, 200));
  const slug = `${first}-${last}`.toLowerCase().replace(/[^a-z-]/g, "");
  return [
    first, last, avatar(first, last, hue), `${first.toLowerCase()}@example.org`,
    rand() < 0.6 ? `https://example.org/people/${slug}` : "",
    team, skills.join(", "), hue, isoDate(start), end,
    (between(6, 10) / 2).toString(), round2(rand()).toString(), (between(120, 900) * 100).toString(),
    between(20, 44).toString(), rand() < 0.5 ? "TRUE" : "FALSE", city, rand() < 0.75 ? pick(TEAM_BIOS[team]) : "",
  ];
});
writeCsv("crew.csv", [
  "First Name", "Last Name", "Photo", "Email", "Website", "Team", "Skills", "Favorite Color", "Project Start", "Project End",
  "Rating", "Goal Progress", "Sales YTD", "Hours per Week", "Remote", "City", "Bio",
], crewRows);

// ── Products: a catalog with drawn thumbnails ─────────────────────────────────
const CATEGORY_ART = {
  Mugs: (c) => `<rect x="16" y="20" width="26" height="30" rx="4" fill="${c}"/><path d="M42 26h5a6 6 0 0 1 0 12h-5" fill="none" stroke="${c}" stroke-width="4"/>`,
  Lamps: (c) => `<path d="M20 34l8-18h8l8 18z" fill="${c}"/><rect x="30" y="34" width="4" height="14" fill="${c}"/><rect x="22" y="48" width="20" height="4" rx="2" fill="${c}"/>`,
  Plants: (c) => `<path d="M22 38h20l-3 14H25z" fill="${c}"/><path d="M32 38c0-10-8-16-14-16 0 8 6 14 14 16zm0 0c0-10 8-16 14-16 0 8-6 14-14 16z" fill="${c}" fill-opacity=".75"/>`,
  Notebooks: (c) => `<rect x="18" y="14" width="28" height="36" rx="3" fill="${c}"/><rect x="18" y="14" width="6" height="36" fill="#000" fill-opacity=".2"/><rect x="28" y="22" width="12" height="3" rx="1.5" fill="#fff" fill-opacity=".7"/>`,
  Audio: (c) => `<path d="M16 38a16 16 0 0 1 32 0" fill="none" stroke="${c}" stroke-width="4"/><rect x="13" y="36" width="8" height="14" rx="3" fill="${c}"/><rect x="43" y="36" width="8" height="14" rx="3" fill="${c}"/>`,
  Chairs: (c) => `<rect x="22" y="12" width="20" height="20" rx="3" fill="${c}"/><rect x="18" y="32" width="28" height="6" rx="2" fill="${c}"/><rect x="20" y="38" width="4" height="14" fill="${c}"/><rect x="40" y="38" width="4" height="14" fill="${c}"/>`,
};
const NAMES = {
  Mugs: ["Morning Mug", "Camp Mug", "Tall Latte Mug", "Espresso Cup"],
  Lamps: ["Desk Lamp", "Arc Floor Lamp", "Clip Light", "Bedside Lamp"],
  Plants: ["Snake Plant", "Pothos", "Fiddle Leaf Fig", "Desk Succulent"],
  Notebooks: ["Dot Grid Notebook", "Field Notes 3-Pack", "Sketchbook A4", "Pocket Planner"],
  Audio: ["Studio Headphones", "Bookshelf Speaker", "Earbuds", "Desk Mic"],
  Chairs: ["Task Chair", "Stool", "Lounge Chair", "Kneeling Chair"],
};
const TAGS = ["gift", "bestseller", "eco", "new", "sale", "limited", "bundle"];
const DESCRIPTIONS = {
  Mugs: ["Glazed stoneware, dishwasher safe, and heavy enough not to tip.", "Holds 350 ml; the handle fits two fingers comfortably."],
  Lamps: ["Warm LED with three brightness steps and a braided cord.", "The arm locks at any angle; the bulb is included."],
  Plants: ["Ships in a nursery pot; water every other week.", "Low light is fine. Keep it away from cold drafts."],
  Notebooks: ["Lay-flat binding with 160 numbered pages.", "Recycled paper throughout, including the cover."],
  Audio: ["Wired and Bluetooth, with a 30-hour battery.", "Back in stock after the spring shortage; limit two per order."],
  Chairs: ["Ships flat and assembles in ten minutes with the included key.", "Seat height adjusts from 42 to 55 cm."],
};
const PRICE = { Mugs: [12, 28], Lamps: [35, 180], Plants: [15, 70], Notebooks: [8, 26], Audio: [45, 320], Chairs: [60, 540] };

const productRows = [];
let n = 0;
for (const [cat, names] of Object.entries(NAMES)) {
  const catIndex = Object.keys(NAMES).indexOf(cat);
  names.forEach((name) => {
    const color = HUES[(catIndex * 2 + n) % HUES.length];
    const img = svgData(`
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="10" fill="${color}" fill-opacity=".16"/>
        ${CATEGORY_ART[cat](color)}
      </svg>`);
    const [lo, hi] = PRICE[cat];
    const stock = rand() < 0.2 ? 0 : between(1, 140);
    const tags = [...new Set([pick(TAGS), pick(TAGS)])].slice(0, between(0, 2));
    productRows.push([
      `SKU-${String(101 + n).padStart(4, "0")}`, name, img, cat, tags.join(", "), color,
      (between(lo, hi) - 0.01).toFixed(2), (between(6, 10) / 2).toString(), stock.toString(), stock > 0 ? "TRUE" : "FALSE",
      isoDate(between(-400, 200)), rand() < 0.6 ? pick(DESCRIPTIONS[cat]) : "",
      rand() < 0.4 ? `https://example.org/shop/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "",
    ]);
    n++;
  });
}
writeCsv("products.csv", [
  "SKU", "Product", "Image", "Category", "Tags", "Color", "Price", "Rating", "Stock", "In Stock", "Launched", "Description", "Website",
], productRows);

// ── Orders: rows that join to both ────────────────────────────────────────────
const CUSTOMERS = ["Acme Corp", "Globex", "Initech", "Umbrella", "Hooli", "Stark Industries", "Wayne Enterprises", "Wonka", "Soylent", "Tyrell"];
const STATUSES = ["Open", "Shipped", "Delivered", "Delivered", "Delivered", "Cancelled"];
const NOTES = ["Deliver to the loading dock after 2pm.", "Gift wrap, and leave out the receipt.", "Call ahead; the office is closed Fridays."];
const orderRows = Array.from({ length: 60 }, (_, i) => {
  const p = pick(productRows);
  const [first, last] = pick(CREW);
  const qty = between(1, 12);
  const status = pick(STATUSES);
  const paid = status === "Cancelled" ? false : status === "Delivered" ? true : status === "Shipped" ? rand() < 0.8 : rand() < 0.3;
  const backordered = status === "Open" && p[8] === "0";
  return [
    `SO-${1001 + i}`, isoDate(between(0, 240)), pick(CUSTOMERS), p[0], qty.toString(),
    (qty * Number(p[6])).toFixed(2), status, `${first} ${last}`, paid ? "TRUE" : "FALSE",
    backordered ? "Backordered until the next shipment arrives." : rand() < 0.2 ? pick(NOTES) : "",
  ];
});
writeCsv("orders.csv", ["Order", "Placed", "Customer", "SKU", "Qty", "Total", "Status", "Rep", "Paid", "Note"], orderRows);

// ── The seed ──────────────────────────────────────────────────────────────────
const nodes = [];
const connections = [];
const node = (id, type, x, y, init, extra = {}) => nodes.push({ id, type, x, y, init, ...extra });
const wire = (source, target, targetInput = "frame", sourceOutput = "frame") =>
  connections.push({ source, sourceOutput, target, targetInput });

const X0 = 0, X1 = 420, X2 = 840, X3 = 1260, X4 = 1680, X5 = 2100;
node("note", "NoteNode", X0 - 480, 60, {
  label: "Cards from files",
  body: [
    "# Files to cards",
    "Local File nodes read three CSV files from the demo vault's **Data** folder: crew, products and orders. Table verbs run on them.",
    "",
    "Orders join a product lookup on SKU and a rep lookup on the rep's full name, and a Keep picks the fields an order card needs.",
    "",
    "Open any Frame chip and switch the popup to **Cards**. The photos and product pictures are `data:image` cells.",
    "",
    "**Record: Cards** draws the same cards as a chart, in the Catalog display below.",
    "",
    "On desktop, point **Settings ▸ Data** at your own folder to read your own files.",
  ].join("\n"),
  width: 400,
  height: 400,
});

const filterEq = (label, column, value, op = "eq") => [
  { label, condConfig: { 0: { op } }, valueKeys: ["frame", "column0", "value0"] },
  { stringLiterals: { column0: column, value0: value } },
];

node("crew", "LocalFileNode", X0, -640, { label: "Crew", fileName: "crew.csv" });
node("products", "LocalFileNode", X0, 380, { label: "Products", fileName: "products.csv" });
node("orders", "LocalFileNode", X0, 1160, { label: "Orders", fileName: "orders.csv" });

node("crew-remote", "FilterFrameNode", X1, -1000, ...filterEq("Filter → remote crew", "Remote", "TRUE"));
wire("crew", "crew-remote");
node("crew-sort", "SortFrameNode", X1, -660, { label: "Sort → rating, best first", dir: "desc" }, { stringLiterals: { column: "Rating" } });
wire("crew", "crew-sort");
node("rep-name", "ComputedColumnNode", X1, -320, { label: "Computed → Rep, the full name", expr: '@[First Name] & " " & @[Last Name]' },
  { stringLiterals: { name: "Rep", after: "" } });
wire("crew", "rep-name");
node("rep-lookup", "ColumnsNode", X2, -320, { label: "Keep → rep lookup" }, { stringLiterals: { columns: "Rep, Photo, Team" } });
wire("rep-name", "rep-lookup");

node("top-rated", "FilterFrameNode", X1, 60, ...filterEq("Filter → rated 4.5 and up", "Rating", "4.5", "gte"));
wire("products", "top-rated");
node("by-price", "SortFrameNode", X1, 400, { label: "Sort → price, high first", dir: "desc" }, { stringLiterals: { column: "Price" } });
wire("products", "by-price");
node("priciest", "HeadNode", X2, 400, { label: "Head → priciest five" }, { literals: { rows: 5 } });
wire("by-price", "priciest");
node("product-lookup", "ColumnsNode", X1, 740, { label: "Keep → product lookup" }, { stringLiterals: { columns: "SKU, Product, Image, Category, Price" } });
wire("products", "product-lookup");

node("order-lines", "JoinNode", X2, 1100, { label: "Join Orders × product lookup (on SKU)", how: "left" }, { stringLiterals: { leftKey: "SKU", rightKey: "SKU" } });
wire("orders", "order-lines", "left");
wire("product-lookup", "order-lines", "right");
node("open-lines", "FilterFrameNode", X3, 1100, ...filterEq("Filter → open orders", "Status", "Open"));
wire("order-lines", "open-lines");
node("with-rep", "JoinNode", X4, 1100, { label: "Join → rep lookup (on Rep)", how: "left" }, { stringLiterals: { leftKey: "Rep", rightKey: "Rep" } });
wire("open-lines", "with-rep", "left");
wire("rep-lookup", "with-rep", "right");
node("order-card", "ColumnsNode", X5, 1100, { label: "Keep → the order card" },
  { stringLiterals: { columns: "Order, Product, Image, Customer, Placed, Qty, Price, Total, Status, Category, Rep, Photo, Paid, Note" } });
wire("with-rep", "order-card");
node("by-category", "GroupByFrameNode", X3, 1460, { label: "GROUPBY Category → SUM(Total)", agg: "sum", totalDepth: 1 }, { stringLiterals: { keys: "Category", column: "Total" } });
wire("order-lines", "by-category");
node("by-status", "GroupByFrameNode", X1, 1500, { label: "GROUPBY Status → SUM(Total)", agg: "sum", totalDepth: 1 }, { stringLiterals: { keys: "Status", column: "Total" } });
wire("orders", "by-status");

node("products-cards", "RecordNode", X1, 1880, { label: "Record: Cards → the catalog", op: "cards" }, { stringLiterals: { rows: "", options: "cardsize=m;clamp=on" } });
wire("products", "products-cards");
node("catalog", "DisplayNode", X2, 1880, { label: "Catalog cards" }, { size: { w: 760, h: 640 } });
connections.push({ source: "products-cards", sourceOutput: "chart", target: "catalog", targetInput: "in" });

const seed = { v: 2, order: 145, label: "Cards from files", group: "Tables", nodes, connections, standoffs: [] };
fs.writeFileSync(SEED, JSON.stringify(seed, null, 2) + "\n");
console.log(`wrote crew.csv (${crewRows.length}), products.csv (${productRows.length}), orders.csv (${orderRows.length}) and ${path.relative(ROOT, SEED)}`);
