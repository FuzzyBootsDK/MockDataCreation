import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema, type SchemaInput } from "../src/model.ts";
import { DataGenerator } from "../src/engine/generator.ts";
import { formulaOrder, FormulaCycleError } from "../src/engine/plan.ts";

const schema = (input: Omit<SchemaInput, "name" | "slug"> & { slug?: string }): Schema =>
  SchemaSchema.parse({ name: input.id, slug: input.slug ?? input.id, ...input });

const customers = schema({
  id: "customers",
  defaultCount: 5,
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "first_name", type: "person.firstName" },
    { name: "last_name", type: "person.lastName" },
    { name: "email", type: "formula", options: { expression: 'lower(first_name) + "." + lower(last_name) + "@example.com"' } },
  ],
});

const orders = schema({
  id: "orders",
  fields: [
    { name: "id", type: "rowNumber" },
    { name: "customer_id", type: "reference", options: { schemaId: "customers", fieldName: "id" } },
    { name: "qty", type: "number", options: { min: 1, max: 5 } },
    { name: "price", type: "number", options: { min: 1, max: 100, decimals: 2 } },
    { name: "total", type: "formula", options: { expression: "round(qty * price, 2)", column: "decimal" } },
  ],
});

describe("formulaOrder", () => {
  test("orders dependencies first, keeps declaration order otherwise", () => {
    expect(formulaOrder([{ name: "c", refs: ["b"] }, { name: "a", refs: [] }, { name: "b", refs: ["a", "x"] }])).toEqual([
      "a", "b", "c",
    ]);
  });

  test("detects cycles", () => {
    expect(() => formulaOrder([{ name: "a", refs: ["b"] }, { name: "b", refs: ["a"] }])).toThrow(FormulaCycleError);
    expect(() => formulaOrder([{ name: "a", refs: ["a"] }])).toThrow(FormulaCycleError);
  });
});

describe("DataGenerator", () => {
  test("same seed gives identical rows; different seed differs", () => {
    const a = [...new DataGenerator([customers]).rows("customers", 20, 7)];
    const b = [...new DataGenerator([customers]).rows("customers", 20, 7)];
    const c = [...new DataGenerator([customers]).rows("customers", 20, 8)];
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test("row(i) equals row i of the stream", () => {
    const all = [...new DataGenerator([customers]).rows("customers", 10, 3)];
    expect(new DataGenerator([customers]).row("customers", 6, 3)).toEqual(all[6]);
  });

  test("keeps declaration order of keys and evaluates formulas", () => {
    const r = new DataGenerator([customers]).row("customers", 0, 1);
    expect(Object.keys(r)).toEqual(["id", "first_name", "last_name", "email"]);
    expect(r.email).toBe(`${String(r.first_name).toLowerCase()}.${String(r.last_name).toLowerCase()}@example.com`);
  });

  test("formula referencing a later formula is evaluated in dependency order", () => {
    const s = schema({
      id: "f",
      fields: [
        { name: "b", type: "formula", options: { expression: "a + 1" } },
        { name: "a", type: "formula", options: { expression: "n * 2" } },
        { name: "n", type: "number", options: { min: 3, max: 3 } },
      ],
    });
    expect(new DataGenerator([s]).row("f", 0, 1)).toEqual({ b: 7, a: 6, n: 3 });
  });

  test("references point at existing parent rows", () => {
    const gen = new DataGenerator([customers, orders]);
    const ids = new Set([...gen.rows("customers", customers.defaultCount, 1)].map((r) => r.id));
    for (const o of gen.rows("orders", 200, 1)) expect(ids.has(o.customer_id)).toBe(true);
  });

  test("reference resolution does not disturb the parent row's sequence", () => {
    // The reference comes before faker-driven fields, so a shared Faker would let
    // resolving a customer (a reseed) change `a` and `b`. Streamed rows (warm
    // reference cache) must match fresh single-row generators (cold cache).
    const ordersLate = schema({
      id: "orders_late",
      slug: "orders-late",
      fields: [
        { name: "id", type: "rowNumber" },
        { name: "customer_id", type: "reference", options: { schemaId: "customers", fieldName: "id" } },
        { name: "a", type: "uuid" },
        { name: "b", type: "person.firstName" },
      ],
    });
    const streamed = [...new DataGenerator([customers, ordersLate]).rows("orders_late", 50, 1)];
    for (let i = 0; i < streamed.length; i++) {
      expect(new DataGenerator([customers, ordersLate]).row("orders_late", i, 1)).toEqual(streamed[i]);
    }
  });

  test("row(i) with a reference equals row i of the stream", () => {
    const all = [...new DataGenerator([customers, orders]).rows("orders", 10, 1)];
    expect(new DataGenerator([customers, orders]).row("orders", 7, 1)).toEqual(all[7]);
  });

  test("blankPercent 100 always null, 0 never null, 30 roughly 30%", () => {
    const s = schema({
      id: "b",
      fields: [
        { name: "always", type: "uuid", blankPercent: 100 },
        { name: "never", type: "uuid", blankPercent: 0 },
        { name: "some", type: "uuid", blankPercent: 30 },
        { name: "f", type: "formula", options: { expression: "concat('x', always)" } },
      ],
    });
    let blanks = 0;
    for (const r of new DataGenerator([s]).rows("b", 2000, 1)) {
      expect(r.always).toBeNull();
      expect(r.never).not.toBeNull();
      expect(r.f).toBe("x");
      if (r.some === null) blanks++;
    }
    expect(blanks).toBeGreaterThan(500);
    expect(blanks).toBeLessThan(700);
  });

  test("nested object and array", () => {
    const s = schema({
      id: "n",
      fields: [
        { name: "address", type: "object", children: [{ name: "city", type: "location.city" }, { name: "zip", type: "location.zipCode" }] },
        { name: "tags", type: "array", options: { minItems: 2, maxItems: 2 }, children: [{ name: "tag", type: "word.noun" }] },
        { name: "lines", type: "array", options: { minItems: 1, maxItems: 3 }, children: [{ name: "sku", type: "uuid" }, { name: "qty", type: "number" }] },
        { name: "city_upper", type: "formula", options: { expression: "upper(address.city)" } },
      ],
    });
    const r = new DataGenerator([s]).row("n", 0, 1) as {
      address: { city: string; zip: string };
      tags: unknown[];
      lines: { sku: string; qty: number }[];
      city_upper: string;
    };
    expect(typeof r.address.city).toBe("string");
    expect(r.tags).toHaveLength(2);
    expect(typeof r.tags[0]).toBe("string");
    expect(r.lines.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(r.lines[0]!)).toEqual(["sku", "qty"]);
    expect(r.city_upper).toBe(r.address.city.toUpperCase());
  });

  test("runtime formula errors produce null and count warnings", () => {
    const s = schema({
      id: "w",
      fields: [
        { name: "z", type: "number", options: { min: 0, max: 0 } },
        { name: "bad", type: "formula", options: { expression: "1 / z" } },
      ],
    });
    const gen = new DataGenerator([s]);
    const rows = [...gen.rows("w", 3, 1)];
    expect(rows.every((r) => r.bad === null)).toBe(true);
    expect(gen.warnings).toBe(3);
  });

  test("locale is applied", () => {
    const da = schema({ id: "da", locale: "da", fields: [{ name: "phone", type: "phone.number" }] });
    expect(String(new DataGenerator([da]).row("da", 0, 1).phone)).toMatch(/^\+45/);
  });

  test("unknown schema id throws", () => {
    expect(() => new DataGenerator([customers]).row("nope", 0, 1)).toThrow("Unknown schema");
  });
});
