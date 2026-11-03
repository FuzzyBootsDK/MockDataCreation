import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema } from "../src/model.ts";
import { findReferenceCycle, referencedSchemaIds, withDependencies } from "../src/order.ts";

const s = (id: string, refs: string[] = []): Schema =>
  SchemaSchema.parse({
    id,
    name: id,
    slug: id,
    fields: [
      { name: "id", type: "rowNumber" },
      ...refs.map((r, i) => ({
        name: `ref${i}`,
        type: "object",
        children: [{ name: "x", type: "reference", options: { schemaId: r, fieldName: "id" } }],
      })),
    ],
  });

describe("order", () => {
  test("referencedSchemaIds walks nested fields", () => {
    expect(referencedSchemaIds(s("a", ["b", "c", "b"]))).toEqual(["b", "c"]);
  });

  test("withDependencies is parent-first and adds transitive deps", () => {
    const set = [s("orders", ["customers", "products"]), s("customers", ["regions"]), s("products"), s("regions")];
    expect(withDependencies(set, ["orders"])).toEqual(["regions", "customers", "products", "orders"]);
    expect(withDependencies(set, ["products", "customers"])).toEqual(["products", "regions", "customers"]);
  });

  test("withDependencies throws on unknown id", () => {
    expect(() => withDependencies([s("a")], ["b"])).toThrow("Unknown schema: b");
  });

  test("findReferenceCycle", () => {
    const set = [s("a", ["b"]), s("b", ["c"]), s("c", ["a"]), s("d")];
    expect(findReferenceCycle(set, "a")).toEqual(["a", "b", "c", "a"]);
    expect(findReferenceCycle(set, "d")).toBeNull();
  });

  test("findReferenceCycle does not re-explore diamonds", () => {
    const depth = 60;
    const set: Schema[] = [];
    for (let i = 0; i < depth; i++) {
      const next = [`a${i + 1}`, `b${i + 1}`];
      set.push(s(`a${i}`, next), s(`b${i}`, next));
    }
    set.push(s(`a${depth}`), s(`b${depth}`));
    expect(findReferenceCycle(set, "a0")).toBeNull();
  });
});
