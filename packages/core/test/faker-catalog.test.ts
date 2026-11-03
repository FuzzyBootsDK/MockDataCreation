import { describe, expect, test } from "vitest";
import { fakerCatalog } from "../src/types/faker-catalog.ts";
import { getFieldType } from "../src/types/index.ts";
import { createFaker } from "../src/engine/fakers.ts";

describe("faker catalog", () => {
  test("has at least 210 types with unique keys", () => {
    expect(fakerCatalog.length).toBeGreaterThanOrEqual(210);
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
    expect(getFieldType("person.firstName")?.category).toBe("Personal");
    expect(getFieldType("internet.email")?.label).toBe("Email Address");
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

describe("Mockaroo-style types", () => {
  const gen = (key: string, options: object = {}, seed = 1) => {
    const t = getFieldType(key)!;
    const faker = createFaker("en");
    faker.seed(seed);
    return t.generate(t.options.parse(options), { faker, rowIndex: 0 });
  };

  test("email address looks like an email", () => {
    expect(gen("internet.email")).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/i);
  });

  test("character sequence follows its pattern", () => {
    expect(gen("characterSequence")).toMatch(/^\d{3}-[A-Z]{3}$/);
    expect(gen("characterSequence", { pattern: "INV-#####" })).toMatch(/^INV-\d{5}$/);
  });

  test("time in 24h and 12h formats", () => {
    expect(gen("time")).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    expect(gen("time", { format: "12h" })).toMatch(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/);
  });

  test("hashes and codes have the right shape", () => {
    expect(gen("hash.sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(gen("hash.md5")).toMatch(/^[0-9a-f]{32}$/);
    expect(gen("location.countryCode.alpha3")).toMatch(/^[A-Z]{3}$/);
    expect(gen("person.ssn")).toMatch(/^\d{3}-\d{2}-\d{4}$/);
    expect(gen("internet.ipv4.cidr")).toMatch(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/);
  });
});
