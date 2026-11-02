import { describe, expect, test } from "vitest";
import { getFieldType, describeFieldTypes } from "../src/types/index.ts";
import { createFaker } from "../src/engine/fakers.ts";

function gen(key: string, options: Record<string, unknown> = {}, rowIndex = 0, seed = 1) {
  const type = getFieldType(key)!;
  const faker = createFaker("en");
  faker.seed(seed);
  return type.generate(type.options.parse(options), { faker, rowIndex });
}

describe("structural types", () => {
  test("rowNumber starts at option start", () => {
    expect(gen("rowNumber", {}, 0)).toBe(1);
    expect(gen("rowNumber", { start: 100 }, 4)).toBe(104);
  });

  test("uuid is deterministic for a seed", () => {
    const a = gen("uuid", {}, 0, 5);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(gen("uuid", {}, 0, 5)).toBe(a);
  });

  test("number respects range and decimals", () => {
    for (let s = 0; s < 50; s++) {
      const n = gen("number", { min: 10, max: 20, decimals: 0 }, 0, s) as number;
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(20);
      const f = gen("number", { min: 0, max: 1, decimals: 2 }, 0, s) as number;
      expect(Math.round(f * 100) / 100).toBe(f);
    }
  });

  test("number rejects min > max", () => {
    expect(getFieldType("number")!.options.safeParse({ min: 5, max: 1 }).success).toBe(false);
  });

  test("boolean truePercent 0 and 100", () => {
    expect(gen("boolean", { truePercent: 0 })).toBe(false);
    expect(gen("boolean", { truePercent: 100 })).toBe(true);
  });

  test("customList picks from values", () => {
    const values = [{ value: "a", weight: 1 }, { value: "b", weight: 3 }];
    for (let s = 0; s < 20; s++) expect(["a", "b"]).toContain(gen("customList", { values }, 0, s));
  });

  test("customList requires at least one value", () => {
    expect(getFieldType("customList")!.options.safeParse({ values: [] }).success).toBe(false);
  });

  test("regex generates matching strings", () => {
    const v = gen("regex", { pattern: "[A-Z]{3}-[0-9]{4}" }) as string;
    expect(v).toMatch(/^[A-Z]{3}-[0-9]{4}$/);
  });

  test("regex rejects invalid pattern", () => {
    expect(getFieldType("regex")!.options.safeParse({ pattern: "([" }).success).toBe(false);
  });

  test("column types depend on options", () => {
    const num = getFieldType("number")!;
    expect(num.column(num.options.parse({ decimals: 0 }))).toBe("bigint");
    expect(num.column(num.options.parse({ decimals: 2 }))).toBe("decimal");
    const formula = getFieldType("formula")!;
    expect(formula.column(formula.options.parse({ expression: "1", column: "int" }))).toBe("int");
  });

  test("kinds", () => {
    expect(getFieldType("formula")!.kind).toBe("formula");
    expect(getFieldType("reference")!.kind).toBe("reference");
    expect(getFieldType("object")!.kind).toBe("object");
    expect(getFieldType("array")!.kind).toBe("array");
    expect(getFieldType("uuid")!.kind).toBe("value");
  });

  test("describeFieldTypes returns JSON Schema for options", () => {
    const info = describeFieldTypes().find((t) => t.key === "number")!;
    expect(info.category).toBe("Basic");
    expect(info.optionsSchema).toMatchObject({ type: "object", properties: { min: { type: "number" } } });
  });
});
