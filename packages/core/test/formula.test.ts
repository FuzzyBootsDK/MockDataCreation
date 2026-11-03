import { describe, expect, test } from "vitest";
import { compileFormula, FormulaError } from "../src/formula/compile.ts";
import { evaluateFormula, FormulaRuntimeError } from "../src/formula/evaluate.ts";

const run = (src: string, scope: Record<string, unknown> = {}) => evaluateFormula(compileFormula(src).ast, scope);

describe("compileFormula", () => {
  test("collects root references once, ignoring helper names", () => {
    expect(compileFormula('lower(first) + "." + lower(last) + first').refs).toEqual(["first", "last"]);
    expect(compileFormula("address.city").refs).toEqual(["address"]);
  });

  test.each([
    ["this", "ThisExpression"],
    ["a[0]", "Computed"],
    ["foo(1)", "Unknown function"],
    ["a = 1", ""],
    ["a.b()", "Only helper functions"],
    ["[1,2]", "ArrayExpression"],
    ["1 +", ""],
  ])("rejects %s", (src, msg) => {
    expect(() => compileFormula(src)).toThrow(FormulaError);
    if (msg) expect(() => compileFormula(src)).toThrow(msg);
  });
});

describe("evaluateFormula", () => {
  test("string building with helpers", () => {
    expect(run('lower(first) + "." + lower(last) + "@example.com"', { first: "Ann", last: "Lee" })).toBe(
      "ann.lee@example.com",
    );
  });

  test("arithmetic", () => {
    expect(run("qty * price", { qty: 3, price: 2.5 })).toBe(7.5);
    expect(run("round(10 / 3, 2)")).toBe(3.33);
    expect(run("-a + 1", { a: 4 })).toBe(-3);
    expect(run("7 % 3")).toBe(1);
  });

  test("null propagation", () => {
    expect(run("qty * 2", { qty: null })).toBeNull();
    expect(run('"x" + name', { name: null })).toBe("x");
    expect(run("lower(name)", { name: null })).toBeNull();
    expect(run("coalesce(a, b, 'z')", { a: null, b: null })).toBe("z");
  });

  test("comparisons, logic and if", () => {
    expect(run("if(age >= 18, 'adult', 'minor')", { age: 20 })).toBe("adult");
    expect(run("a == 1 && b != 2", { a: 1, b: 3 })).toBe(true);
    expect(run("!flag", { flag: false })).toBe(true);
    expect(run("a || 'default'", { a: "" })).toBe("default");
  });

  test("member access on nested objects only reads own properties", () => {
    expect(run("address.city", { address: { city: "Aarhus" } })).toBe("Aarhus");
    expect(run("address.constructor", { address: {} })).toBeNull();
    expect(run("address.city", { address: null })).toBeNull();
  });

  test("dateAdd keeps the input format", () => {
    expect(run("dateAdd(d, 1, 'days')", { d: "2024-01-31" })).toBe("2024-02-01");
    expect(run("dateAdd(d, 2, 'hours')", { d: "2024-01-01T00:00:00.000Z" })).toBe("2024-01-01T02:00:00.000Z");
    expect(run("dateAdd(d, 1, 'months')", { d: "2024-01-15" })).toBe("2024-02-15");
    expect(run("dateAdd(d, -1, 'years')", { d: "2024-06-01" })).toBe("2023-06-01");
  });

  test("slug, upper, trim, concat", () => {
    expect(run("slug('Hello Wörld!')")).toBe("hello-world");
    expect(run("upper(trim('  a '))")).toBe("A");
    expect(run("concat('a', 1, null, true)")).toBe("a1true");
  });

  test("runtime errors", () => {
    expect(() => run("1 / 0")).toThrow(FormulaRuntimeError);
    expect(() => run("'abc' * 2")).toThrow(FormulaRuntimeError);
    expect(() => run("dateAdd('nope', 1, 'days')")).toThrow(FormulaRuntimeError);
    expect(() => run("dateAdd('2024-01-01', 1, 'weeks')")).toThrow(FormulaRuntimeError);
  });

  test("dateAdd out of range throws FormulaRuntimeError", () => {
    expect(() => run("dateAdd('2024-01-01', 10000000000, 'years')")).toThrow(FormulaRuntimeError);
    expect(() => run("dateAdd('2024-01-01', 10000000000, 'years')")).toThrow("Date out of range");
  });

  test("if is lazy: only the chosen branch is evaluated", () => {
    expect(run("if(b == 0, 0, 1 / b)", { b: 0 })).toBe(0);
    expect(run("if(b == 0, 0, 1 / b)", { b: 4 })).toBe(0.25);
    expect(run("if(false, 1)")).toBeNull();
  });

  test("prototype names are not helpers", () => {
    const ast = { type: "CallExpression", callee: { type: "Identifier", name: "constructor" }, arguments: [] };
    expect(() => evaluateFormula(ast, {})).toThrow(FormulaRuntimeError);
    expect(() => evaluateFormula(ast, {})).toThrow("Unknown function");
  });
});

describe("formula limits", () => {
  test("rejects formulas longer than the maximum length", () => {
    const src = "1+".repeat(1000) + "1"; // 2001 characters
    expect(src.length).toBe(2001);
    expect(() => compileFormula(src)).toThrow(FormulaError);
    expect(() => compileFormula(src)).toThrow("too long");
  });

  test("accepts moderately nested parentheses", () => {
    const src = "(".repeat(300) + "1" + ")".repeat(300); // 601 characters
    expect(run(src)).toBe(1);
  });
});
