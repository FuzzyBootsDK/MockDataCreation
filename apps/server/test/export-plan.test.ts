import { describe, expect, test } from "vitest";
import { SchemaSchema } from "@mockgen/core";
import { resolveExport } from "../src/export-plan.ts";

const customers = SchemaSchema.parse({ id: "c", name: "C", slug: "customers", defaultCount: 5, seed: 3, fields: [{ name: "id", type: "rowNumber" }] });
const orders = SchemaSchema.parse({
  id: "o", name: "O", slug: "orders", defaultCount: 20, seed: 9,
  fields: [{ name: "id", type: "rowNumber" }, { name: "c", type: "reference", options: { schemaId: "c", fieldName: "id" } }],
});
const all = [customers, orders];

describe("resolveExport", () => {
  test("adds dependencies parent-first with default counts and first requested seed", () => {
    const r = resolveExport(all, [{ id: "o" }], { maxRows: 1000 });
    expect(r.items.map((i) => [i.schema.slug, i.count])).toEqual([["customers", 5], ["orders", 20]]);
    expect(r.seed).toBe(9);
  });

  test("explicit seed and count on a non-referenced schema", () => {
    const r = resolveExport(all, [{ id: "o", count: 50 }], { maxRows: 1000, seed: 1 });
    expect(r.items[1]!.count).toBe(50);
    expect(r.seed).toBe(1);
  });

  test("referenced schema count must equal defaultCount", () => {
    expect(() => resolveExport(all, [{ id: "o" }, { id: "c", count: 6 }], { maxRows: 1000 })).toThrow("customers");
    expect(resolveExport(all, [{ id: "o" }, { id: "c", count: 5 }], { maxRows: 1000 }).items).toHaveLength(2);
  });

  test("limits and unknown ids", () => {
    expect(() => resolveExport(all, [{ id: "o", count: 1001 }], { maxRows: 1000 })).toThrow("1000");
    expect(() => resolveExport(all, [{ id: "x" }], { maxRows: 1000 })).toThrow("x");
    expect(() => resolveExport(all, [], { maxRows: 1000 })).toThrow();
  });
});
