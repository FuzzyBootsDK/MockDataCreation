import { describe, expect, test } from "vitest";
import { SchemaSchema, type Schema } from "../src/model.ts";
import { formatPath, validateSchema } from "../src/validate.ts";

const saved: Schema[] = [
  SchemaSchema.parse({ id: "customers", name: "Customers", slug: "customers", fields: [{ name: "id", type: "rowNumber" }] }),
];

const base = { id: "new", name: "New", slug: "orders" };
const paths = (input: unknown, others = saved) => validateSchema(input, others).issues.map((i) => i.path);
const messages = (input: unknown, others = saved) => validateSchema(input, others).issues.map((i) => i.message);

describe("formatPath", () => {
  test("formats arrays with brackets", () => {
    expect(formatPath(["fields", 3, "options", "min"])).toBe("fields[3].options.min");
    expect(formatPath([])).toBe("");
  });
});

describe("validateSchema", () => {
  test("valid schema returns parsed schema", () => {
    const r = validateSchema({ ...base, fields: [{ name: "id", type: "rowNumber" }] }, saved);
    expect(r.issues).toEqual([]);
    expect(r.schema?.locale).toBe("en");
  });

  test("zod issues are mapped to bracket paths", () => {
    expect(paths({ ...base, fields: [{ name: "1x", type: "uuid" }] })).toContain("fields[0].name");
  });

  test("duplicate slug", () => {
    expect(paths({ ...base, slug: "customers", fields: [{ name: "id", type: "uuid" }] })).toEqual(["slug"]);
    // Same id may keep its own slug.
    expect(paths({ ...saved[0], fields: [{ name: "id", type: "uuid" }] })).toEqual([]);
  });

  test("unknown locale", () => {
    expect(paths({ ...base, locale: "xx_YY", fields: [{ name: "id", type: "uuid" }] })).toEqual(["locale"]);
  });

  test("duplicate field names and unknown types", () => {
    expect(
      paths({ ...base, fields: [{ name: "a", type: "uuid" }, { name: "a", type: "uuid" }, { name: "b", type: "nope" }] }),
    ).toEqual(["fields[1].name", "fields[2].type"]);
  });

  test("invalid options are reported under options", () => {
    expect(paths({ ...base, fields: [{ name: "n", type: "number", options: { min: 5, max: 1 } }] })).toEqual([
      "fields[0].options.min",
    ]);
  });

  test("children rules", () => {
    expect(paths({ ...base, fields: [{ name: "o", type: "object" }] })).toEqual(["fields[0].children"]);
    expect(paths({ ...base, fields: [{ name: "u", type: "uuid", children: [{ name: "x", type: "uuid" }] }] })).toEqual([
      "fields[0].children",
    ]);
    expect(
      paths({ ...base, fields: [{ name: "o", type: "object", children: [{ name: "x", type: "nope" }] }] }),
    ).toEqual(["fields[0].children[0].type"]);
  });

  test("nesting deeper than 5 levels", () => {
    let field: Record<string, unknown> = { name: "leaf", type: "uuid" };
    for (let i = 0; i < 6; i++) field = { name: `o${i}`, type: "object", children: [field] };
    expect(messages({ ...base, fields: [field] }).some((m) => m.includes("Nesting deeper than 5"))).toBe(true);
  });

  test("formula syntax, unknown refs and cycles", () => {
    expect(paths({ ...base, fields: [{ name: "f", type: "formula", options: { expression: "1 +" } }] })).toEqual([
      "fields[0].options.expression",
    ]);
    expect(messages({ ...base, fields: [{ name: "f", type: "formula", options: { expression: "nope + 1" } }] })).toEqual([
      'Unknown field "nope"',
    ]);
    const cyc = validateSchema(
      {
        ...base,
        fields: [
          { name: "a", type: "formula", options: { expression: "b" } },
          { name: "b", type: "formula", options: { expression: "a" } },
        ],
      },
      saved,
    ).issues;
    expect(cyc).toHaveLength(1);
    expect(cyc[0]!.path).toBe("fields[0].options.expression");
    expect(cyc[0]!.message).toContain("Circular formula reference");
  });

  test("references must point at an existing schema and top-level field", () => {
    const ref = (schemaId: string, fieldName: string) => ({
      ...base,
      fields: [{ name: "c", type: "reference", options: { schemaId, fieldName } }],
    });
    expect(paths(ref("customers", "id"))).toEqual([]);
    expect(paths(ref("missing", "id"))).toEqual(["fields[0].options.schemaId"]);
    expect(paths(ref("customers", "nope"))).toEqual(["fields[0].options.fieldName"]);
    expect(paths(ref("new", "c"))).toEqual(["fields[0].options.schemaId"]);
  });

  test("cross-schema reference cycles", () => {
    const a = SchemaSchema.parse({
      id: "a",
      name: "A",
      slug: "a",
      fields: [{ name: "id", type: "rowNumber" }, { name: "b", type: "reference", options: { schemaId: "b", fieldName: "id" } }],
    });
    const r = validateSchema(
      { id: "b", name: "B", slug: "b", fields: [{ name: "id", type: "rowNumber" }, { name: "a", type: "reference", options: { schemaId: "a", fieldName: "id" } }] },
      [a],
    );
    expect(r.issues.map((i) => i.path)).toEqual(["fields"]);
    expect(r.issues[0]!.message).toContain("Circular reference between schemas: b → a → b");
  });
});
