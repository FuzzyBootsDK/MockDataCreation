import { describe, expect, test } from "vitest";
import { fakerCatalog } from "../src/types/faker-catalog.ts";
import { getFieldType } from "../src/types/index.ts";
import { createFaker } from "../src/engine/fakers.ts";

describe("faker catalog", () => {
  test("has at least 90 types with unique keys", () => {
    expect(fakerCatalog.length).toBeGreaterThanOrEqual(90);
    expect(new Set(fakerCatalog.map((t) => t.key)).size).toBe(fakerCatalog.length);
  });

  test.each(fakerCatalog.map((t) => [t.key, t] as const))("%s generates a scalar value", (_key, type) => {
    const faker = createFaker("en");
    faker.seed(1);
    const v = type.generate(type.options.parse({}), { faker, rowIndex: 0 });
    expect(v).not.toBeUndefined();
    expect(v).not.toBeNull();
    expect(["string", "number", "boolean"]).toContain(typeof v);
  });

  test("registered in the registry", () => {
    expect(getFieldType("person.firstName")?.category).toBe("Person");
  });

  test("date.between respects range and format", () => {
    const t = getFieldType("date.between")!;
    const faker = createFaker("en");
    faker.seed(3);
    const v = t.generate(t.options.parse({ from: "2024-01-01", to: "2024-01-31", format: "date" }), {
      faker,
      rowIndex: 0,
    }) as string;
    expect(v).toMatch(/^2024-01-\d{2}$/);
    expect(t.column(t.options.parse({ format: "date" }))).toBe("date");
  });

  test("locale changes output", () => {
    const t = getFieldType("location.city")!;
    const en = createFaker("en");
    const da = createFaker("da");
    en.seed(1);
    da.seed(1);
    const a = t.generate({}, { faker: en, rowIndex: 0 });
    const b = t.generate({}, { faker: da, rowIndex: 0 });
    expect(a).not.toBe(b);
  });

  test("relative dates are stable (fixed reference date)", () => {
    const t = getFieldType("date.past")!;
    const f1 = createFaker("en");
    f1.seed(9);
    const v = t.generate(t.options.parse({}), { faker: f1, rowIndex: 0 }) as string;
    expect(v < "2026-01-01").toBe(true);
    expect(v >= "2025-01-01").toBe(true);
  });
});
