// [[C114]] cardsView, [[C103]] untrustedContentSeams
import { describe, it, expect } from "vitest";
import {
  planCards, nameWords, cardMatches, linkHref, shortLink, splitTags, isHexColor,
  type CardColumnInput, type CardColType, type CardPlan,
} from "../../src/graph/cardLayout";

const col = (name: string, type: CardColType, cells: string[], extra: Partial<CardColumnInput> = {}): CardColumnInput => ({ name, type, cells, ...extra });

const EMPTY: CardPlan = {
  image: null, key: null, title: null, titleRest: [], subtitle: null, meta: null, metaEnd: null, hero: null,
  chips: [], tags: [], swatches: [], flags: [], ratings: [], meters: [], stats: [], prose: [],
};

const people = [
  col("ID", "number", ["1", "2", "3", "4"]),
  col("Name", "string", ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra"]),
  col("Email", "string", ["ada@x.org", "alan@x.org", "grace@x.org", "edsger@x.org"]),
  col("Dept", "string", ["Math", "CS", "CS", "Math"]),
  col("Started", "date", ["01-Jan-1843", "01-Jan-1936", "01-Jan-1944", "01-Jan-1959"]),
  col("Salary", "number", ["100", "200", "300", "400"]),
  col("Age", "number", ["36", "41", "85", "72"]),
  col("Active", "logical", ["TRUE", "FALSE", "TRUE", "FALSE"]),
  col("Bio", "string", [
    "An English mathematician and writer, chiefly known for her work on the Analytical Engine.",
    "An English mathematician, computer scientist and logician.",
    "An American computer scientist and United States Navy rear admiral.",
    "A Dutch computer scientist, programmer and software engineer.",
  ]),
];

const placed = (p: CardPlan): number[] =>
  [p.image, p.key, p.title, ...p.titleRest, p.subtitle, p.meta, p.metaEnd, p.hero, ...p.chips, ...p.tags, ...p.swatches,
    ...p.flags, ...p.ratings, ...p.meters.map((m) => m.col), ...p.stats, ...p.prose]
    .filter((i): i is number => i !== null)
    .sort((a, b) => a - b);

describe("planCards: which part of the card each column fills", () => {
  it("lays a typical people table out as key, title, subtitle, meta, hero, chips, flags, stats and prose", () => {
    expect(planCards(people)).toEqual({ ...EMPTY, key: 0, title: 1, subtitle: 2, meta: 4, hero: 5, chips: [3], flags: [7], stats: [6], prose: [8] });
  });

  it("puts nested cells only in tags (a list column so named) or stats", () => {
    const nested = [
      col("Project", "string", ["Web", "App", "Ops"]),
      col("Tags", "string", ["[web, q4]", "[ios]", "[ops]"], { nested: true, lists: true }),
      col("Plan", "string", ["[2×3 Table]", "[3×2 Table]", "[1×1 Table]"], { nested: true }),
      col("Name", "string", ["[3×2×1 Cube]", "[2×2×1 Cube]", "[1×2×1 Cube]"], { nested: true }),
    ];
    expect(planCards(nested)).toEqual({ ...EMPTY, title: 0, tags: [1], stats: [2, 3] });
  });

  it("places every column exactly once, even an empty one", () => {
    expect(placed(planCards(people))).toEqual(people.map((_, i) => i));
    const withBlank = [...people, col("Spare", "string", ["", "", "", ""])];
    expect(placed(planCards(withBlank))).toEqual(withBlank.map((_, i) => i));
  });

  it("is deterministic: the same columns always give the same plan", () => {
    expect(planCards(people)).toEqual(planCards(people.map((c) => ({ ...c, cells: [...c.cells] }))));
  });

  it("prefers a name-like header for the title over a column further left", () => {
    const p = planCards([
      col("City", "string", ["Oslo", "Lima", "Pune", "Kyiv"]),
      col("Product Name", "string", ["Widget", "Gadget", "Doohickey", "Sprocket"]),
    ]);
    expect(p.title).toBe(0); // "city" is itself a title word, and ties go left
    const q = planCards([
      col("Code", "string", ["a1", "b2", "c3", "d4"]),
      col("Colour", "string", ["Red", "Blue", "Green", "Teal"]),
      col("Product Name", "string", ["Widget", "Gadget", "Doohickey", "Sprocket"]),
    ]);
    expect(q.key).toBe(0);
    expect(q.title).toBe(2);
    expect(q.subtitle).toBe(1);
  });

  it("joins a first and last name into one title, a middle name between", () => {
    const p = planCards([
      col("Last Name", "string", ["Lovelace", "Turing"]),
      col("Email", "string", ["ada@x.org", "alan@x.org"]),
      col("First Name", "string", ["Ada", "Alan"]),
      col("Middle Name", "string", ["", "Mathison"]),
    ]);
    expect(p.title).toBe(2);
    expect(p.titleRest).toEqual([3, 0]);
    expect(p.subtitle).toBe(1);
  });

  it("takes the headline number by its name, a Total over a Price", () => {
    const p = planCards([
      col("Item", "string", ["a", "b", "c"]),
      col("Price", "number", ["1", "2", "3"]),
      col("Qty", "number", ["4", "5", "6"]),
      col("Total", "number", ["4", "10", "18"]),
    ]);
    expect(p.hero).toBe(3);
    expect(p.stats).toEqual([1, 2]);
  });

  it("with no named number, the headline is a currency column, else the rightmost one that isn't a year", () => {
    const p = planCards([
      col("Country", "string", ["NO", "PE", "IN"]),
      col("Population", "number", ["5", "33", "1400"]),
      col("Area", "number", ["385", "1285", "3287"]),
      col("Year", "number", ["2024", "2024", "2023"]),
    ]);
    expect(p.hero).toBe(2);
    expect(p.meta).toBe(3); // a Year column with no date column is the card's date line
    expect(p.stats).toEqual([1]);
    const q = planCards([
      col("Thing", "string", ["a", "b"]),
      col("Spend", "number", ["5", "6"], { shown: ["$5.00", "$6.00"] }),
      col("Weight", "number", ["7", "8"]),
    ]);
    expect(q.hero).toBe(1);
    const r = planCards([
      col("Thing", "string", ["a", "b"]),
      col("Bucks", "number", ["5", "6"], { shown: ["$5.00", "$6.00"] }),
      col("Weight", "number", ["7", "8"]),
    ]);
    expect(r.hero).toBe(1);
  });

  it("reads a first column counting up from one as a key, but not a later one or a repeating one", () => {
    expect(planCards([col("n", "number", ["1", "2", "3"]), col("x", "number", ["9", "8", "7"])]).key).toBe(0);
    expect(planCards([col("x", "number", ["9", "8", "7"]), col("n", "number", ["1", "2", "3"])]).key).toBeNull();
    expect(planCards([col("ID", "number", ["1", "1", "2"])]).key).toBeNull();
    expect(planCards([col("Invoice Number", "number", ["40", "12", "77"])]).key).toBe(0);
  });

  it("reads a column of unique codes as the key whatever its name", () => {
    const p = planCards([
      col("Order", "string", ["SO-1000", "SO-1001", "SO-1002"]),
      col("Customer", "string", ["Acme", "Globex", "Initech"]),
    ]);
    expect(p.key).toBe(0);
    expect(p.title).toBe(1);
    expect(planCards([col("Order", "string", ["SO-1", "SO-1", "SO-2"])]).key).toBeNull();
    expect(planCards([col("Word", "string", ["alpha", "beta", "gamma"])]).key).toBeNull();
    expect(planCards([col("Name", "string", ["Item 1", "Item 2", "Item 3"])]).key).toBeNull(); // a name-like header is a title
  });

  it("makes short repeating text a chip, and honors a column's Chip format", () => {
    const p = planCards([
      col("Name", "string", ["a", "b", "c", "d"]),
      col("Status", "string", ["Open", "Done", "Open", "Open"]),
      col("Kind", "string", ["x", "y", "z", "w"], { chip: true }),
    ]);
    expect(p.chips).toEqual([1, 2]);
  });

  it("never chips text with no repeats, or a table too short to tell", () => {
    expect(planCards([col("Name", "string", ["a", "b", "c", "d"]), col("S", "string", ["p", "q", "r", "s"])]).chips).toEqual([]);
    expect(planCards([col("Name", "string", ["a", "b"]), col("S", "string", ["p", "p"])]).chips).toEqual([]);
  });

  it("splits a Tags column into chips", () => {
    const p = planCards([col("Name", "string", ["a", "b"]), col("Tags", "string", ["red, blue", "blue; green"])]);
    expect(p.tags).toEqual([1]);
  });

  it("puts long text full width, and short text too when its name says it is a note", () => {
    const p = planCards([
      col("Name", "string", ["Ada", "Bob", "Cyd"]),
      col("Notes", "string", ["Call before the delivery", "Leave it at the side door", ""]),
      col("Remark", "string", ["short", "x".repeat(120), ""]),
      col("Colour Name", "string", ["Sunset orange with red", "Deep ocean blue green", ""]),
    ]);
    expect(p.prose).toEqual([1, 2]);
    expect(p.subtitle).toBe(3);
  });

  it("shows only data:image pictures, never a web address, which stays text", () => {
    const px = "data:image/png;base64,iVBORw0KGgo=";
    const p = planCards([
      col("Photo", "string", [px, px, ""]),
      col("Name", "string", ["a", "b", "c"]),
      col("Avatar", "string", ["https://x.org/a.png", "https://x.org/b.jpg", "https://x.org/c.gif"]),
    ]);
    expect(p.image).toBe(0);
    expect(p.title).toBe(1);
    expect(p.subtitle).toBeNull(); // a web address is never the subtitle
    expect(p.stats).toEqual([2]);
  });

  it("keeps a second picture column out of the prose and the title, and a lone surname out of the title", () => {
    const px = "data:image/png;base64," + "A".repeat(200);
    const p = planCards([
      col("Order", "string", ["SO-1", "SO-2", "SO-3"]),
      col("Image", "string", [px, px, px]),
      col("Product", "string", ["Earbuds", "Desk Lamp", "Stool"]),
      col("Last Name", "string", ["Allen", "Hopper", "Turing"]),
      col("Photo", "string", [px, px, px]),
    ]);
    expect(p.image).toBe(1);
    expect(p.title).toBe(2);
    expect(p.prose).toEqual([]);
    expect(p.stats).toContain(4);
  });

  it("draws a column of hex colors as swatches", () => {
    expect(planCards([col("Name", "string", ["a", "b"]), col("Color", "string", ["#ff0000", "#0f0"])]).swatches).toEqual([1]);
    expect(planCards([col("Name", "string", ["a", "b"]), col("Color", "string", ["#ff0000", "red"])]).swatches).toEqual([]);
  });

  it("gives a date range its end: a Start date with an End date", () => {
    const p = planCards([
      col("Trip", "string", ["Rome", "Oslo"]),
      col("Start Date", "date", ["46000", "46100"]),
      col("End Date", "date", ["46005", "46103"]),
      col("Booked", "date", ["45900", "45950"]),
    ]);
    expect(p.meta).toBe(1);
    expect(p.metaEnd).toBe(2);
    expect(p.stats).toEqual([3]);
    expect(planCards([col("Booked", "date", ["1"]), col("End", "date", ["2"])]).metaEnd).toBeNull();
  });

  it("stars a Rating of 0 to 5, never one past 5", () => {
    expect(planCards([col("Name", "string", ["a", "b"]), col("Rating", "number", ["4", "3.5"])]).ratings).toEqual([1]);
    expect(planCards([col("Name", "string", ["a", "b"]), col("Rating", "number", ["8", "9"])]).ratings).toEqual([]);
  });

  it("draws a meter for a percent column, and for a progress-like name on a 0 to 1 or 0 to 100 scale", () => {
    expect(planCards([col("Name", "string", ["a"]), col("Win", "number", ["0.4"], { shown: ["40%"] })]).meters).toEqual([{ col: 1, max: 1 }]);
    expect(planCards([col("Name", "string", ["a"]), col("Progress", "number", ["0.4"])]).meters).toEqual([{ col: 1, max: 1 }]);
    expect(planCards([col("Name", "string", ["a"]), col("Done %", "number", ["40"])]).meters).toEqual([{ col: 1, max: 100 }]);
    expect(planCards([col("Name", "string", ["a"]), col("Progress", "number", ["140"])]).meters).toEqual([]);
    expect(planCards([col("Name", "string", ["a"]), col("Progress", "number", ["-0.1"])]).meters).toEqual([]);
  });

  it("leaves the title empty when no text column can carry it", () => {
    const p = planCards([col("x", "number", ["1.5", "2.5"]), col("y", "number", ["3", "4"])]);
    expect(p.title).toBeNull();
    expect(p.subtitle).toBeNull();
    expect(p.hero).toBe(1);
    expect(p.stats).toEqual([0]);
  });

  it("handles an empty frame", () => {
    expect(planCards([])).toEqual(EMPTY);
  });
});

describe("cell helpers", () => {
  it("nameWords splits spaces, punctuation and camelCase, keeping #", () => {
    expect(nameWords("Customer ID")).toEqual(["customer", "id"]);
    expect(nameWords("orderTotal")).toEqual(["order", "total"]);
    expect(nameWords("unit_price")).toEqual(["unit", "price"]);
    expect(nameWords("#")).toEqual(["#"]);
  });

  it("linkHref links only http(s) and email addresses", () => {
    expect(linkHref(" https://example.org/a ")).toBe("https://example.org/a");
    expect(linkHref("ada@x.org")).toBe("mailto:ada@x.org");
    expect(linkHref("javascript:alert(1)")).toBeNull();
    expect(linkHref("ftp://x.org")).toBeNull();
    expect(linkHref("see https://x.org")).toBeNull();
  });

  it("shortLink drops the scheme and www, and cuts a long path to its first part", () => {
    expect(shortLink("https://www.example.org/")).toBe("example.org");
    expect(shortLink("https://example.org/docs/guide/getting-started/installation?x=1")).toBe("example.org/docs…");
  });

  it("splitTags and isHexColor", () => {
    expect(splitTags("red, blue;green ,, ")).toEqual(["red", "blue", "green"]);
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#abcd12")).toBe(true);
    expect(isHexColor("abc")).toBe(false);
  });

  it("cardMatches matches every word of the query, in any cell, ignoring case", () => {
    expect(cardMatches(["Ada Lovelace", "Math"], "")).toBe(true);
    expect(cardMatches(["Ada Lovelace", "Math"], "ada math")).toBe(true);
    expect(cardMatches(["Ada Lovelace", "Math"], "ada cs")).toBe(false);
  });
});
