// [[D88]] cardsView
import { describe, it, expect } from "vitest";
import { planCards, nameWords, cardMatches, type CardColumnInput, type CardColType } from "../../src/graph/cardLayout";

const col = (name: string, type: CardColType, cells: string[], chip = false): CardColumnInput => ({ name, type, cells, chip });

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

describe("planCards: which part of the card each column fills", () => {
  it("lays a typical people table out as key, title, subtitle, meta, hero, chips, flags, stats and prose", () => {
    expect(planCards(people)).toEqual({
      image: null,
      key: 0,
      title: 1,
      subtitle: 2,
      meta: 4,
      hero: 5,
      chips: [3],
      flags: [7],
      stats: [6],
      prose: [8],
    });
  });

  it("places every column exactly once", () => {
    const p = planCards(people);
    const all = [p.image, p.key, p.title, p.subtitle, p.meta, p.hero, ...p.chips, ...p.flags, ...p.stats, ...p.prose]
      .filter((i): i is number => i !== null)
      .sort((a, b) => a - b);
    expect(all).toEqual(people.map((_, i) => i));
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

  it("with no named number, the headline is the rightmost one that isn't a year", () => {
    const p = planCards([
      col("Country", "string", ["NO", "PE", "IN"]),
      col("Population", "number", ["5", "33", "1400"]),
      col("Area", "number", ["385", "1285", "3287"]),
      col("Year", "number", ["2024", "2024", "2023"]),
    ]);
    expect(p.hero).toBe(2);
    expect(p.stats).toEqual([1, 3]);
  });

  it("reads a first column counting up from one as a key, but not a later one or a repeating one", () => {
    expect(planCards([col("n", "number", ["1", "2", "3"]), col("x", "number", ["9", "8", "7"])]).key).toBe(0);
    expect(planCards([col("x", "number", ["9", "8", "7"]), col("n", "number", ["1", "2", "3"])]).key).toBeNull();
    expect(planCards([col("ID", "number", ["1", "1", "2"])]).key).toBeNull();
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
  });

  it("makes short repeating text a chip, and honors a column's Chip format", () => {
    const p = planCards([
      col("Name", "string", ["a", "b", "c", "d"]),
      col("Status", "string", ["Open", "Done", "Open", "Open"]),
      col("Tag", "string", ["x", "y", "z", "w"], true),
    ]);
    expect(p.chips).toEqual([1, 2]);
  });

  it("never chips text with no repeats, or a table too short to tell", () => {
    expect(planCards([col("Name", "string", ["a", "b", "c", "d"]), col("S", "string", ["p", "q", "r", "s"])]).chips).toEqual([]);
    expect(planCards([col("Name", "string", ["a", "b"]), col("S", "string", ["p", "p"])]).chips).toEqual([]);
  });

  it("puts long text full width, and a column of image addresses beside the title", () => {
    const p = planCards([
      col("Photo", "string", ["https://x.org/a.png", "https://x.org/b.jpg", ""]),
      col("Name", "string", ["a", "b", "c"]),
      col("Notes", "string", ["short", "x".repeat(120), ""]),
    ]);
    expect(p.image).toBe(0);
    expect(p.title).toBe(1);
    expect(p.prose).toEqual([2]);
  });

  it("leaves the title empty when no text column can carry it", () => {
    const p = planCards([col("x", "number", ["1.5", "2.5"]), col("y", "number", ["3", "4"])]);
    expect(p.title).toBeNull();
    expect(p.subtitle).toBeNull();
    expect(p.hero).toBe(1);
    expect(p.stats).toEqual([0]);
  });

  it("handles an empty frame", () => {
    expect(planCards([])).toEqual({ image: null, key: null, title: null, subtitle: null, meta: null, hero: null, chips: [], flags: [], stats: [], prose: [] });
  });
});

describe("nameWords", () => {
  it("splits spaces, punctuation and camelCase, keeping #", () => {
    expect(nameWords("Customer ID")).toEqual(["customer", "id"]);
    expect(nameWords("orderTotal")).toEqual(["order", "total"]);
    expect(nameWords("unit_price")).toEqual(["unit", "price"]);
    expect(nameWords("#")).toEqual(["#"]);
  });
});

describe("cardMatches", () => {
  it("matches every word of the query, in any cell, ignoring case", () => {
    expect(cardMatches(["Ada Lovelace", "Math"], "")).toBe(true);
    expect(cardMatches(["Ada Lovelace", "Math"], "ada math")).toBe(true);
    expect(cardMatches(["Ada Lovelace", "Math"], "ada cs")).toBe(false);
  });
});
